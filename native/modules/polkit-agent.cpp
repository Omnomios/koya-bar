#include "module.hpp"
#include "authentication.hpp"
#include <memory>
#include <dlfcn.h>

// Adapted from the phone shell. Native polkit owns the authentication exchange;
// the desktop shell supplies the dialog and relays askpass calls from its bus.
struct PolkitModule: NativeModule {
    GDBusConnection *bus = nullptr;
    std::unique_ptr<AuthenticationAgent> agent;
    using NativeModule::NativeModule;
    void shutdown() override {
        agent.reset();
        if (bus) { g_dbus_connection_close_sync(bus, nullptr, nullptr); g_object_unref(bus); bus = nullptr; }
    }
    static JSValue start(NativeModule *base, int argc, JSValueConst *argv) {
        auto *self = static_cast<PolkitModule *>(base);
        if (argc != 1 || !JS_IsFunction(base->js, argv[0])) return JS_ThrowTypeError(base->js, "start expects an authentication event callback");
        self->subscribe(argv[0]);
        if (!self->agent) {
            GError *error = nullptr;
            gchar *address = g_dbus_address_get_for_bus_sync(G_BUS_TYPE_SESSION, nullptr, &error);
            if (address) self->bus = g_dbus_connection_new_for_address_sync(address,
                static_cast<GDBusConnectionFlags>(G_DBUS_CONNECTION_FLAGS_AUTHENTICATION_CLIENT | G_DBUS_CONNECTION_FLAGS_MESSAGE_BUS_CONNECTION), nullptr, nullptr, &error);
            g_free(address);
            if (!self->bus) { JSValue result = JS_ThrowInternalError(base->js, "%s", error ? error->message : "Session bus unavailable"); g_clear_error(&error); return result; }
            self->agent = std::make_unique<AuthenticationAgent>(self->bus, [self](const char *member, GVariant *args) {
                JSValue event = JS_NewObject(self->js);
                JS_SetPropertyStr(self->js, event, "member", JS_NewString(self->js, member));
                JS_SetPropertyStr(self->js, event, "args", variant(self->js, args)); self->emit(event);
            });
            // koya-askpass is built next to this module.
            Dl_info location{};
            if (dladdr(reinterpret_cast<void *>(&PolkitModule::start), &location) && location.dli_fname) {
                char *directory = g_path_get_dirname(location.dli_fname);
                char *resolved = realpath((std::string(directory) + "/koya-askpass").c_str(), nullptr);
                if (resolved) self->agent->askpass = resolved;
                free(resolved); g_free(directory);
            }
        }
        return JS_NewBool(base->js, self->agent->start());
    }
    static JSValue ask(NativeModule *base, int argc, JSValueConst *argv) {
        auto *self = static_cast<PolkitModule *>(base);
        if (argc != 3 || !JS_IsString(argv[0]) || !JS_IsString(argv[1]) || !JS_IsString(argv[2])) return JS_ThrowTypeError(base->js, "ask expects (prompt, mode, sender)");
        if (!self->agent) return JS_ThrowInternalError(base->js, "Authentication is unavailable");
        const auto question = string(base->js, argv[0]), mode = string(base->js, argv[1]), sender = string(base->js, argv[2]);
        if (question.find('\0') != std::string::npos || sender.empty() || sender[0] != ':') return JS_ThrowTypeError(base->js, "Invalid authentication request");
        JSValue callbacks[2]; JSValue promise = JS_NewPromiseCapability(base->js, callbacks);
        if (JS_IsException(promise)) return promise;
        self->agent->ask(question.c_str(), mode.c_str(), sender.c_str(), [self, resolve = callbacks[0], reject = callbacks[1]](bool cancelled, const char *answer) {
            JSValue value;
            if (cancelled) {
                value = JS_NewError(self->js); JS_SetPropertyStr(self->js, value, "message", JS_NewString(self->js, "Authentication cancelled"));
            } else value = JS_NewString(self->js, answer);
            JSValue result = JS_Call(self->js, cancelled ? reject : resolve, JS_UNDEFINED, 1, &value);
            if (JS_IsException(result)) JS_FreeValue(self->js, JS_GetException(self->js));
            JS_FreeValue(self->js, result); JS_FreeValue(self->js, value); JS_FreeValue(self->js, resolve); JS_FreeValue(self->js, reject);
        });
        return promise;
    }
};
extern "C" HELIX_PLUGIN_EXPORT int helix_plugin_integrate(JSContext *ctx, const char *name, const HelixPluginHost *host, HelixPluginInstance **out) {
    // GObject retains this listener type's vtable after the module shuts down.
    Dl_info location{};
    if (dladdr(reinterpret_cast<void *>(&helix_plugin_integrate), &location) && location.dli_fname) {
        if (void *handle = dlopen(location.dli_fname, RTLD_NOW | RTLD_LOCAL | RTLD_NODELETE)) dlclose(handle);
    }
    auto *self = new PolkitModule(ctx);
    self->functions = {{"start", PolkitModule::start}, {"ask", PolkitModule::ask},
        {"stop", [](NativeModule *base, int, JSValueConst *) { auto *self = static_cast<PolkitModule *>(base); if (self->agent) self->agent->stop(); return JS_UNDEFINED; }},
        {"respond", [](NativeModule *base, int argc, JSValueConst *argv) {
            uint32_t id;
            if (argc != 2 || JS_ToUint32(base->js, &id, argv[0]) < 0 || !JS_IsString(argv[1])) return JS_ThrowTypeError(base->js, "respond expects (id, answer)");
            auto answer = NativeModule::string(base->js, argv[1]); auto *self = static_cast<PolkitModule *>(base);
            if (self->agent) self->agent->respond(id, answer.c_str());
            explicit_bzero(answer.data(), answer.size()); return JS_UNDEFINED;
        }},
        {"cancel", [](NativeModule *base, int argc, JSValueConst *argv) {
            uint32_t id;
            if (argc != 1 || JS_ToUint32(base->js, &id, argv[0]) < 0) return JS_ThrowTypeError(base->js, "cancel expects an id");
            auto *self = static_cast<PolkitModule *>(base); if (self->agent) self->agent->cancel(id); return JS_UNDEFINED;
        }}};
    if (self->integrate(name, host, out)) return 0;
    delete self; return 1;
}
