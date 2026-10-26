#include "module.hpp"
#include <atomic>
#include <thread>
#include <dlfcn.h>
#include <unistd.h>
#include <vector>

struct FingerprintModule: NativeModule {
    GSubprocess *child = nullptr;
    std::thread worker;
    std::atomic<bool> done{false};
    bool accepted = false, cancelled = false;
    int exitCode = -1;
    JSValue progress = JS_UNDEFINED;
    std::mutex messagesMutex;
    std::vector<std::string> messages;
    gint64 deadline = 0;
    JSValue resolve = JS_UNDEFINED;
    using NativeModule::NativeModule;

    static std::string helper() {
        Dl_info location{};
        if (!dladdr(reinterpret_cast<void *>(&helper), &location) || !location.dli_fname) return "";
        char *directory = g_path_get_dirname(location.dli_fname);
        std::string path = std::string(directory) + "/koya-fingerprint-auth";
        g_free(directory); return path;
    }
    void cancel() {
        if (!child) return;
        cancelled = true;
        g_subprocess_force_exit(child);
    }
    void finish() {
        if (worker.joinable()) worker.join();
        g_clear_object(&child); done = false;
        JSValue value = JS_NewObject(js);
        JS_SetPropertyStr(js, value, "ok", JS_NewBool(js, accepted && !cancelled));
        JS_SetPropertyStr(js, value, "cancelled", JS_NewBool(js, cancelled));
        const char *reason = accepted ? "success" : exitCode == 2 ? "configuration" : exitCode == 3 ? "account" : exitCode == 4 ? "attempts" : "retry";
        JS_SetPropertyStr(js, value, "reason", JS_NewString(js, reason));
        JS_FreeValue(js, progress); progress = JS_UNDEFINED;
        JSValue callback = resolve; resolve = JS_UNDEFINED;
        JSValue result = JS_Call(js, callback, JS_UNDEFINED, 1, &value);
        if (JS_IsException(result)) JS_FreeValue(js, JS_GetException(js));
        JS_FreeValue(js, callback); JS_FreeValue(js, result); JS_FreeValue(js, value);
    }
    void shutdown() override {
        cancel();
        if (worker.joinable()) worker.join();
        g_clear_object(&child);
        JS_FreeValue(js, resolve); resolve = JS_UNDEFINED;
        JS_FreeValue(js, progress); progress = JS_UNDEFINED;
    }
    void update() override {
        NativeModule::update();
        if (!child) return;
        std::vector<std::string> pending;
        { std::lock_guard<std::mutex> lock(messagesMutex); pending.swap(messages); }
        if (!cancelled && JS_IsFunction(js, progress)) for (const auto &message : pending) {
            JSValue value = JS_NewStringLen(js, message.data(), message.size());
            JSValue result = JS_Call(js, progress, JS_UNDEFINED, 1, &value);
            if (JS_IsException(result)) JS_FreeValue(js, JS_GetException(js));
            JS_FreeValue(js, result); JS_FreeValue(js, value);
        }
        if (done.load()) finish();
        else if (!cancelled && g_get_monotonic_time() >= deadline) cancel();
    }
    static JSValue available(NativeModule *base, int, JSValueConst *) {
        return JS_NewBool(base->js, access("/etc/pam.d/koya-fingerprint", R_OK) == 0 && access(helper().c_str(), X_OK) == 0);
    }
    static JSValue verify(NativeModule *base, int argc, JSValueConst *argv) {
        auto *self = static_cast<FingerprintModule *>(base);
        if (self->child) return JS_ThrowInternalError(base->js, "Fingerprint verification is already running");
        GError *error = nullptr;
        self->child = g_subprocess_new(static_cast<GSubprocessFlags>(G_SUBPROCESS_FLAGS_STDOUT_PIPE | G_SUBPROCESS_FLAGS_STDERR_SILENCE),
            &error, helper().c_str(), nullptr);
        if (!self->child) {
            JSValue result = JS_ThrowInternalError(base->js, "%s", error ? error->message : "Fingerprint helper is unavailable");
            g_clear_error(&error); return result;
        }
        JSValue callbacks[2];
        JSValue promise = JS_NewPromiseCapability(base->js, callbacks);
        if (JS_IsException(promise)) { self->cancel(); g_subprocess_wait(self->child, nullptr, nullptr); g_clear_object(&self->child); return promise; }
        self->resolve = callbacks[0]; JS_FreeValue(base->js, callbacks[1]);
        self->progress = argc && JS_IsFunction(base->js, argv[0]) ? JS_DupValue(base->js, argv[0]) : JS_UNDEFINED;
        { std::lock_guard<std::mutex> lock(self->messagesMutex); self->messages.clear(); }
        self->cancelled = false; self->accepted = false; self->done = false; self->exitCode = -1;
        self->deadline = g_get_monotonic_time() + 35 * G_TIME_SPAN_SECOND;
        self->worker = std::thread([self] {
            auto *stream = g_subprocess_get_stdout_pipe(self->child);
            char buffer[1024]; std::string line;
            for (;;) {
                gssize count = g_input_stream_read(stream, buffer, sizeof(buffer), nullptr, nullptr);
                if (count <= 0) break;
                for (gssize i = 0; i < count; ++i) {
                    if (buffer[i] == '\n') {
                        std::lock_guard<std::mutex> lock(self->messagesMutex);
                        if (self->messages.size() < 16 && !line.empty()) self->messages.push_back(line);
                        line.clear();
                    } else if (line.size() < 2048) line += buffer[i];
                }
            }
            self->accepted = g_subprocess_wait_check(self->child, nullptr, nullptr);
            if (g_subprocess_get_if_exited(self->child)) self->exitCode = g_subprocess_get_exit_status(self->child);
            self->done = true;
        });
        return promise;
    }
};

extern "C" HELIX_PLUGIN_EXPORT int helix_plugin_integrate(JSContext *ctx, const char *name,
    const HelixPluginHost *host, HelixPluginInstance **out) {
    auto *self = new FingerprintModule(ctx);
    self->functions = {{"available", FingerprintModule::available}, {"verify", FingerprintModule::verify},
        {"cancel", [](NativeModule *base, int, JSValueConst *) { static_cast<FingerprintModule *>(base)->cancel(); return JS_UNDEFINED; }}};
    if (self->integrate(name, host, out)) return 0;
    delete self; return 1;
}
