#include "module.hpp"
#include "sleep-inhibitor.hpp"
#include <atomic>
#include <thread>

// Sleep inhibition belongs to the desktop shell, not the native desktop
// services loaded by the login greeter. Keep its worker and FD independent.
struct SleepModule: NativeModule {
    SleepInhibitor inhibitor;
    std::thread worker;
    std::atomic<bool> done{false};
    bool pending = false;
    std::string error;
    JSValue resolve = JS_UNDEFINED, reject = JS_UNDEFINED;
    using NativeModule::NativeModule;
    void finish(const std::string &message) {
        pending = false;
        JSValue value = message.empty() ? JS_NewBool(js, true) : JS_NewString(js, message.c_str());
        JSValue result = JS_Call(js, message.empty() ? resolve : reject, JS_UNDEFINED, 1, &value);
        if (JS_IsException(result)) JS_FreeValue(js, JS_GetException(js));
        JS_FreeValue(js, value); JS_FreeValue(js, result);
        JS_FreeValue(js, resolve); JS_FreeValue(js, reject);
        resolve = reject = JS_UNDEFINED;
    }
    void shutdown() override {
        inhibitor.release();
        if (worker.joinable()) worker.join();
        done = false;
        if (pending) finish("Sleep module stopped");
    }
    void update() override {
        NativeModule::update();
        if (!done.exchange(false)) return;
        worker.join();
        finish(error);
    }
    static JSValue acquire(NativeModule *base, int, JSValueConst *) {
        auto *self = static_cast<SleepModule *>(base);
        if (self->pending) return JS_ThrowInternalError(base->js, "Sleep inhibition is already pending");
        JSValue callbacks[2];
        JSValue promise = JS_NewPromiseCapability(base->js, callbacks);
        if (JS_IsException(promise)) return promise;
        self->resolve = callbacks[0]; self->reject = callbacks[1];
        self->pending = true; self->error.clear();
        const auto request = self->inhibitor.begin();
        self->worker = std::thread([self, request] {
            self->inhibitor.acquire(request, self->error);
            self->done = true;
        });
        return promise;
    }
};

extern "C" HELIX_PLUGIN_EXPORT int helix_plugin_integrate(JSContext *ctx, const char *name,
    const HelixPluginHost *host, HelixPluginInstance **out) {
    auto *self = new SleepModule(ctx);
    self->functions = {{"acquire", SleepModule::acquire},
        {"release", [](NativeModule *base, int, JSValueConst *) {
            static_cast<SleepModule *>(base)->inhibitor.release(); return JS_UNDEFINED;
        }}};
    if (self->integrate(name, host, out)) return 0;
    delete self; return 1;
}
