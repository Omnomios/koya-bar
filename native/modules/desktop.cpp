#include "module.hpp"
#include "icons.hpp"
#include "wallpapers.hpp"
#include "avatars.hpp"
#include "passwords.hpp"
#include <gio/gdesktopappinfo.h>
#include <memory>
#include <atomic>
#include <thread>
#include <condition_variable>
#include <deque>
#include <pwd.h>
#include <unistd.h>

struct DesktopModule: NativeModule {
    std::string root;
    std::unique_ptr<Icons> icons;
    Wallpapers wallpapers;
    GAppInfoMonitor *monitor = nullptr;
    gulong handler = 0;
    guint notification = 0;
    std::map<std::string, GDesktopAppInfo *> apps;
    struct Job { unsigned id; std::string kind, argument; };
    struct Result { unsigned id; std::string json, error; };
    struct Promise { JSValue resolve, reject; };
    std::map<unsigned, Promise> promises;
    unsigned serial = 0;
    std::mutex mutex;
    std::condition_variable wake;
    std::deque<Job> jobs;
    std::deque<Result> results;
    std::thread worker;
    bool ending = false;
    std::atomic<bool> invalidated{false};
    using NativeModule::NativeModule;
    static std::string preferences_path() {
        return std::string(g_get_user_config_dir()) + "/koya-bar/settings.json";
    }
    static JSValue load_json(NativeModule *base, const std::string &path) {
        gchar *contents = nullptr; gsize size = 0;
        if (!g_file_get_contents(path.c_str(), &contents, &size, nullptr)) return JS_NewObject(base->js);
        JSValue value = JS_ParseJSON(base->js, contents, size, "<desktop-settings>"); g_free(contents);
        if (JS_IsException(value)) { JS_FreeValue(base->js, JS_GetException(base->js)); return JS_NewObject(base->js); }
        return value;
    }
    static JSValue load_preferences(NativeModule *base, int, JSValueConst *) { return load_json(base, preferences_path()); }
    static std::string displays_path() { return std::string(g_get_user_config_dir()) + "/koya-bar/displays.json"; }
    static JSValue load_displays(NativeModule *base, int, JSValueConst *) { return load_json(base, displays_path()); }
    static JSValue save_json(NativeModule *base, int argc, JSValueConst *argv, const std::string &path) {
        if (argc != 1 || !JS_IsString(argv[0])) return JS_ThrowTypeError(base->js, "savePreferences expects JSON text");
        const std::string contents = string(base->js, argv[0]);
        const std::string directory = std::string(g_get_user_config_dir()) + "/koya-bar";
        if (g_mkdir_with_parents(directory.c_str(), 0700) != 0) return JS_ThrowInternalError(base->js, "Cannot create settings directory");
        GError *error = nullptr;
        // GLib writes through a temporary file and renames it over the target.
        if (!g_file_set_contents(path.c_str(), contents.c_str(), contents.size(), &error)) {
            JSValue value = JS_ThrowInternalError(base->js, "%s", error ? error->message : "Cannot save settings");
            g_clear_error(&error); return value;
        }
        return JS_UNDEFINED;
    }
    static JSValue save_preferences(NativeModule *base, int argc, JSValueConst *argv) { return save_json(base, argc, argv, preferences_path()); }
    static JSValue save_displays(NativeModule *base, int argc, JSValueConst *argv) { return save_json(base, argc, argv, displays_path()); }
    static std::string quote(const char *text) {
        std::string result = "\"";
        for (const unsigned char *p = reinterpret_cast<const unsigned char *>(text ? text : ""); *p; ++p) {
            if (*p == '"' || *p == '\\') { result += '\\'; result += *p; }
            else if (*p < 32) { char escaped[7]; snprintf(escaped, sizeof escaped, "\\u%04x", *p); result += escaped; }
            else result += *p;
        }
        return result + '"';
    }
    void clear() { for (auto &entry : apps) g_object_unref(entry.second); apps.clear(); }
    void shutdown() override {
        if (monitor) { g_signal_handler_disconnect(monitor, handler); g_object_unref(monitor); monitor = nullptr; }
        remove(notification);
        { std::lock_guard<std::mutex> lock(mutex); ending = true; jobs.clear(); }
        wake.notify_all(); if (worker.joinable()) worker.join();
        for (auto &entry : promises) {
            JSValue error = JS_NewString(js, "Desktop module stopped");
            JSValue result = JS_Call(js, entry.second.reject, JS_UNDEFINED, 1, &error);
            JS_FreeValue(js, result); JS_FreeValue(js, error);
            JS_FreeValue(js, entry.second.resolve); JS_FreeValue(js, entry.second.reject);
        }
        promises.clear(); results.clear(); clear(); icons.reset();
    }
    void update() override {
        NativeModule::update();
        std::deque<Result> completed;
        { std::lock_guard<std::mutex> lock(mutex); completed.swap(results); }
        for (auto &result : completed) {
            auto entry = promises.find(result.id); if (entry == promises.end()) continue;
            JSValue value = result.error.empty() ? JS_ParseJSON(js, result.json.c_str(), result.json.size(), "<desktop>") : JS_NewString(js, result.error.c_str());
            bool failed = !result.error.empty();
            if (JS_IsException(value)) { value = JS_GetException(js); failed = true; }
            JSValue returned = JS_Call(js, failed ? entry->second.reject : entry->second.resolve, JS_UNDEFINED, 1, &value);
            if (JS_IsException(returned)) JS_FreeValue(js, JS_GetException(js));
            JS_FreeValue(js, returned); JS_FreeValue(js, value);
            JS_FreeValue(js, entry->second.resolve); JS_FreeValue(js, entry->second.reject); promises.erase(entry);
        }
    }
    static bool launchable(GDesktopAppInfo *info) {
        if (!g_app_info_should_show(G_APP_INFO(info))) return false;
        gchar *try_exec = g_desktop_app_info_get_string(info, "TryExec");
        bool explicit_check = try_exec && *try_exec;
        gchar **arguments = nullptr;
        if (!explicit_check) {
            const char *command = g_app_info_get_commandline(G_APP_INFO(info));
            if (command) g_shell_parse_argv(command, nullptr, &arguments, nullptr);
        }
        const char *program = explicit_check ? try_exec : arguments ? arguments[0] : g_app_info_get_executable(G_APP_INFO(info));
        bool activated = !explicit_check && g_desktop_app_info_get_boolean(info, "DBusActivatable");
        gchar *found = program && *program ? g_find_program_in_path(program) : nullptr;
        bool result = found || activated; g_free(found); g_free(try_exec); g_strfreev(arguments); return result;
    }
    void read() {
        clear(); GList *list = g_app_info_get_all();
        for (GList *item = list; item; item = item->next) {
            auto *info = G_APP_INFO(item->data); const char *id = g_app_info_get_id(info);
            if (id && G_IS_DESKTOP_APP_INFO(info) && launchable(G_DESKTOP_APP_INFO(info))) apps[id] = G_DESKTOP_APP_INFO(g_object_ref(info));
        }
        g_list_free_full(list, g_object_unref);
        for (const auto &directory : {root + "/build", root + "/applications"}) {
            GDir *dir = g_dir_open(directory.c_str(), 0, nullptr);
            if (!dir) continue;
            while (const char *name = g_dir_read_name(dir)) {
                if (!g_str_has_suffix(name, ".desktop") || apps.count(name)) continue;
                auto *info = g_desktop_app_info_new_from_filename((directory + "/" + name).c_str());
                if (info && launchable(info)) apps[name] = info; else if (info) g_object_unref(info);
            }
            g_dir_close(dir);
        }
    }
    std::string applications() {
        read(); std::string result = "[";
        for (auto &app : apps) {
            if (result.size() > 1) result += ',';
            result += '{'; bool first = true;
            auto add = [&](const char *key, const char *value) { if (!first) result += ','; first = false; result += quote(key) + ':' + quote(value); };
            add("id", app.first.c_str()); add("name", g_app_info_get_display_name(G_APP_INFO(app.second))); add("class", g_desktop_app_info_get_startup_wm_class(app.second));
            add("genericName", g_desktop_app_info_get_generic_name(app.second));
            add("comment", g_app_info_get_description(G_APP_INFO(app.second)));
            std::string keywords;
            if (const char *const *items = g_desktop_app_info_get_keywords(app.second))
                for (; *items; ++items) { if (!keywords.empty()) keywords += ' '; keywords += *items; }
            add("keywords", keywords.c_str());
            add("categories", g_desktop_app_info_get_categories(app.second));
            GIcon *icon = g_app_info_get_icon(G_APP_INFO(app.second)); gchar *description = icon ? g_icon_to_string(icon) : nullptr;
            add("iconName", description); g_free(description); add("icon", "");
            const char *executable = g_app_info_get_executable(G_APP_INFO(app.second)); gchar *name = executable ? g_path_get_basename(executable) : g_strdup("");
            add("executable", name); g_free(name); result += '}';
        }
        return result + ']';
    }
    void run() {
        for (;;) {
            Job job;
            { std::unique_lock<std::mutex> lock(mutex); wake.wait(lock, [&] { return ending || !jobs.empty(); });
                if (ending) return;
                job = std::move(jobs.front()); jobs.pop_front(); }
            Result result{job.id, {}, {}};
            if (icons && invalidated.exchange(false)) icons->invalidate();
            if (job.kind == "wallpapers") result.json = wallpapers.list();
            else if (job.kind == "importWallpaper") { std::string error; result.json = wallpapers.import(job.argument, error); if (result.json.empty()) result.error = error; }
            else if (job.kind == "removeWallpaper") { if (wallpapers.remove(job.argument)) result.json = "true"; else result.error = "Cannot remove wallpaper"; }
            else if (job.kind == "prepareAvatar") {
                std::string error, path = Avatars::prepare(job.argument, error);
                if (path.empty()) result.error = error; else result.json = quote(path.c_str());
            }
            else if (job.kind == "changePassword") {
                // The argument is the current and new password, NUL-separated.
                const size_t split = job.argument.find('\0');
                Passwords::Outcome outcome = split == std::string::npos ? Passwords::Outcome{false, "Could not change the password", ""}
                    : Passwords::change(job.argument.substr(0, split), job.argument.substr(split + 1));
                result.json = std::string("{\"ok\":") + (outcome.ok ? "true" : "false") + ",\"message\":" + quote(outcome.message.c_str())
                    + ",\"field\":" + quote(outcome.field.c_str()) + "}";
                Passwords::erase(job.argument);
            }
            else if (job.kind == "applications") result.json = applications();
            else if (job.kind == "resolveIcon") {
                GIcon *icon = g_icon_new_for_string(job.argument.c_str(), nullptr);
                result.json = quote(icon ? icons->resolve(icon).c_str() : ""); if (icon) g_object_unref(icon);
            } else if (job.kind == "launch") {
                read(); auto app = apps.find(job.argument);
                if (app == apps.end()) result.error = "Application is unavailable";
                else {
                    GAppLaunchContext *launch = g_app_launch_context_new();
                    GError *error = nullptr;
                    if (g_app_info_launch(G_APP_INFO(app->second), nullptr, launch, &error)) result.json = "true";
                    else result.error = error ? error->message : "Cannot launch application";
                    g_clear_error(&error); g_object_unref(launch);
                }
            }

            { std::lock_guard<std::mutex> lock(mutex); if (!ending) results.push_back(std::move(result)); }
        }
    }
    static JSValue start(NativeModule *base, int argc, JSValueConst *argv) {
        auto *self = static_cast<DesktopModule *>(base);
        if (argc != 2 || !JS_IsString(argv[0]) || !JS_IsFunction(base->js, argv[1])) return JS_ThrowTypeError(base->js, "start expects (root, onApplicationsChanged)");
        self->shutdown(); self->root = string(base->js, argv[0]); self->icons = std::make_unique<Icons>(self->root); self->subscribe(argv[1]);
        self->ending = false; self->invalidated = false; self->worker = std::thread([self] { self->run(); });
        self->monitor = g_app_info_monitor_get();
        self->handler = g_signal_connect(self->monitor, "changed", G_CALLBACK(+[](GAppInfoMonitor *, gpointer data) {
            auto *self = static_cast<DesktopModule *>(data); self->invalidated = true;
            if (self->notification) return;
            GSource *source = g_idle_source_new();
            g_source_set_callback(source, [](gpointer data)->gboolean {
                auto *self = static_cast<DesktopModule *>(data); self->notification = 0; self->emit(JS_UNDEFINED); return G_SOURCE_REMOVE;
            }, self, nullptr);
            self->notification = g_source_attach(source, self->context); g_source_unref(source);
        }), self);
        return JS_UNDEFINED;
    }
    // Image jobs need no application state, so they start the worker on
    // demand in apps that never call start().
    JSValue enqueue(const char *kind, std::string argument = "") {
        const bool standalone = g_str_has_suffix(kind, "allpaper") || !strcmp(kind, "wallpapers") || !strcmp(kind, "prepareAvatar") || !strcmp(kind, "changePassword");
        if (!icons && !standalone) return JS_ThrowInternalError(js, "Desktop module is not started");
        if (!worker.joinable()) { ending = false; worker = std::thread([this] { run(); }); }
        if (promises.size() >= 128) return JS_ThrowInternalError(js, "Too many pending desktop requests");
        JSValue callbacks[2]; JSValue promise = JS_NewPromiseCapability(js, callbacks);
        if (JS_IsException(promise)) return promise;
        unsigned id = ++serial; promises.emplace(id, Promise{callbacks[0], callbacks[1]});
        { std::lock_guard<std::mutex> lock(mutex); jobs.push_back(Job{id, kind, std::move(argument)}); }
        wake.notify_one(); return promise;
    }
};
extern "C" HELIX_PLUGIN_EXPORT int helix_plugin_integrate(JSContext *ctx, const char *name, const HelixPluginHost *host, HelixPluginInstance **out) {
    auto *self = new DesktopModule(ctx);
    self->functions = {{"processId", [](NativeModule *base, int, JSValueConst *) { return JS_NewUint32(base->js, getpid()); }},
        {"userName", [](NativeModule *base, int, JSValueConst *) {
            passwd *user = getpwuid(getuid());
            if (!user || !user->pw_name) return JS_ThrowInternalError(base->js, "Cannot resolve the current account");
            return JS_NewString(base->js, user->pw_name);
        }}, {"loadPreferences", DesktopModule::load_preferences}, {"savePreferences", DesktopModule::save_preferences},
        {"loadDisplays", DesktopModule::load_displays}, {"saveDisplays", DesktopModule::save_displays},
        {"start", DesktopModule::start}, {"applications", [](NativeModule *base, int, JSValueConst *) { return static_cast<DesktopModule *>(base)->enqueue("applications"); }},
        {"launch", [](NativeModule *base, int argc, JSValueConst *argv) { if (argc != 1 || !JS_IsString(argv[0])) return JS_ThrowTypeError(base->js, "launch expects a desktop entry ID"); return static_cast<DesktopModule *>(base)->enqueue("launch", NativeModule::string(base->js, argv[0])); }},
        {"wallpapers", [](NativeModule *base, int, JSValueConst *) { return static_cast<DesktopModule *>(base)->enqueue("wallpapers"); }},
        {"prepareAvatar", [](NativeModule *base, int argc, JSValueConst *argv) {
            if (argc != 1 || !JS_IsString(argv[0])) return JS_ThrowTypeError(base->js, "prepareAvatar expects an image path or file URI");
            return static_cast<DesktopModule *>(base)->enqueue("prepareAvatar", NativeModule::string(base->js, argv[0]));
        }},
        {"importWallpaper", [](NativeModule *base, int argc, JSValueConst *argv) { if (argc != 1 || !JS_IsString(argv[0])) return JS_ThrowTypeError(base->js, "importWallpaper expects a path or file URI"); return static_cast<DesktopModule *>(base)->enqueue("importWallpaper", NativeModule::string(base->js, argv[0])); }},
        {"removeWallpaper", [](NativeModule *base, int argc, JSValueConst *argv) { if (argc != 1 || !JS_IsString(argv[0])) return JS_ThrowTypeError(base->js, "removeWallpaper expects a wallpaper ID"); return static_cast<DesktopModule *>(base)->enqueue("removeWallpaper", NativeModule::string(base->js, argv[0])); }},
        {"changePassword", [](NativeModule *base, int argc, JSValueConst *argv) {
            if (argc != 2 || !JS_IsString(argv[0]) || !JS_IsString(argv[1])) return JS_ThrowTypeError(base->js, "changePassword expects the current and new password");
            std::string current = NativeModule::string(base->js, argv[0]), next = NativeModule::string(base->js, argv[1]);
            if (current.empty() || next.empty() || current.size() > 512 || next.size() > 512 || current.find('\0') != std::string::npos || next.find('\0') != std::string::npos) {
                Passwords::erase(current); Passwords::erase(next); return JS_ThrowRangeError(base->js, "Invalid password");
            }
            std::string argument = current + '\0' + next;
            Passwords::erase(current); Passwords::erase(next);
            JSValue promise = static_cast<DesktopModule *>(base)->enqueue("changePassword", argument);
            Passwords::erase(argument); return promise;
        }},
        {"resolveIcon", [](NativeModule *base, int argc, JSValueConst *argv) { if (argc != 1) return JS_ThrowTypeError(base->js, "resolveIcon expects a description"); return static_cast<DesktopModule *>(base)->enqueue("resolveIcon", NativeModule::string(base->js, argv[0])); }}};
    if (self->integrate(name, host, out)) return 0;
    delete self; return 1;
}
