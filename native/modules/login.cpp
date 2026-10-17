#include "module.hpp"
#include <sys/fsuid.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <pwd.h>
#include <sys/un.h>
#include <unistd.h>
#include <cerrno>
#include <cstring>
#include <algorithm>
#include <set>
#include <vector>

// greetd owns authentication and the user session. This module only transports
// its length-prefixed JSON protocol and discovers system Wayland session files.
// It also keeps the greeter's own state (the last account to sign in) and
// reads an account's desktop settings for the login wallpaper.
struct LoginModule: NativeModule {
    int fd = -1;
    guint io = 0, timer = 0;
    bool pending = false, connecting = false;
    std::string outgoing, incoming;
    size_t sent = 0, received = 0, header_bytes = 0;
    uint32_t length = 0;
    JSValue resolve = JS_UNDEFINED, reject = JS_UNDEFINED;
    using NativeModule::NativeModule;
    static constexpr size_t max_packet = 1024 * 1024;
    static void erase(std::string &value) { explicit_bzero(value.data(), value.size()); value.clear(); }
    void disconnect() {
        remove(io); remove(timer);
        if (fd >= 0) close(fd);
        fd = -1; connecting = false; erase(outgoing); incoming.clear();
    }
    void finish(JSValue value, bool failed = false) {
        remove(io); remove(timer); pending = false; erase(outgoing); incoming.clear();
        JSValue callback = failed ? reject : resolve;
        JS_FreeValue(js, failed ? resolve : reject);
        resolve = reject = JS_UNDEFINED;
        JSValue result = JS_Call(js, callback, JS_UNDEFINED, 1, &value);
        if (JS_IsException(result)) JS_FreeValue(js, JS_GetException(js));
        JS_FreeValue(js, result); JS_FreeValue(js, callback); JS_FreeValue(js, value);
    }
    void fail(const char *message) {
        disconnect();
        if (!pending) return;
        JSValue error = JS_NewError(js);
        JS_SetPropertyStr(js, error, "message", JS_NewString(js, message));
        finish(error, true);
    }
    void shutdown() override { fail("Login connection closed"); }
    bool connect_socket() {
        if (fd >= 0) return true;
        const char *path = g_getenv("GREETD_SOCK");
        if (!path || !*path) { fail("GREETD_SOCK is not set; start the greeter through greetd"); return false; }
        sockaddr_un address{}; address.sun_family = AF_UNIX;
        if (strlen(path) >= sizeof address.sun_path) { fail("Invalid greetd socket path"); return false; }
        strcpy(address.sun_path, path);
        fd = socket(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC | SOCK_NONBLOCK, 0);
        if (fd < 0) { fail("Cannot create login socket"); return false; }
        if (::connect(fd, reinterpret_cast<sockaddr *>(&address), sizeof address) < 0) {
            if (errno != EINPROGRESS) { fail("Cannot connect to greetd"); return false; }
            connecting = true;
        }
        return true;
    }
    void write_request() {
        if (connecting) {
            int error = 0; socklen_t size = sizeof error;
            if (getsockopt(fd, SOL_SOCKET, SO_ERROR, &error, &size) < 0 || error) { fail("Cannot connect to greetd"); return; }
            connecting = false;
        }
        while (sent < outgoing.size()) {
            ssize_t count = send(fd, outgoing.data() + sent, outgoing.size() - sent, MSG_NOSIGNAL);
            if (count < 0 && errno == EINTR) continue;
            if (count < 0 && (errno == EAGAIN || errno == EWOULDBLOCK)) return;
            if (count <= 0) { fail("greetd disconnected while sending"); return; }
            sent += count;
        }
        erase(outgoing); remove(io);
        io = watch(fd, GIOCondition(G_IO_IN | G_IO_HUP | G_IO_ERR), [](gint, GIOCondition, gpointer data) -> gboolean {
            auto *self = static_cast<LoginModule *>(data); self->read_reply(); return self->pending ? G_SOURCE_CONTINUE : G_SOURCE_REMOVE;
        }, this);
    }
    void read_reply() {
        while (pending) {
            void *buffer = header_bytes < sizeof length ? static_cast<void *>(reinterpret_cast<char *>(&length) + header_bytes)
                : static_cast<void *>(incoming.data() + received);
            size_t remaining = header_bytes < sizeof length ? sizeof length - header_bytes : incoming.size() - received;
            ssize_t count = recv(fd, buffer, remaining, 0);
            if (count < 0 && errno == EINTR) continue;
            if (count < 0 && (errno == EAGAIN || errno == EWOULDBLOCK)) return;
            if (count <= 0) { fail("greetd disconnected while receiving"); return; }
            if (header_bytes < sizeof length) {
                header_bytes += count;
                if (header_bytes == sizeof length) {
                    if (!length || length > max_packet) { fail("Invalid greetd reply length"); return; }
                    incoming.resize(length);
                }
            } else {
                received += count;
                if (received == incoming.size()) {
                    JSValue reply = JS_ParseJSON(js, incoming.data(), incoming.size(), "<greetd>");
                    if (JS_IsException(reply)) { JS_FreeValue(js, JS_GetException(js)); fail("Invalid JSON from greetd"); }
                    else finish(reply);
                    return;
                }
            }
        }
    }
    static JSValue request(NativeModule *base, int argc, JSValueConst *argv) {
        auto *self = static_cast<LoginModule *>(base);
        if (argc != 1 || !JS_IsString(argv[0])) return JS_ThrowTypeError(base->js, "request expects JSON text");
        if (self->pending) return JS_ThrowInternalError(base->js, "A login request is already pending");
        std::string payload = string(base->js, argv[0]);
        if (payload.empty() || payload.size() > max_packet) { erase(payload); return JS_ThrowRangeError(base->js, "Invalid login request length"); }
        JSValue callbacks[2]; JSValue promise = JS_NewPromiseCapability(base->js, callbacks);
        if (JS_IsException(promise)) { erase(payload); return promise; }
        self->resolve = callbacks[0]; self->reject = callbacks[1]; self->pending = true;
        self->sent = self->received = self->header_bytes = 0; self->length = 0;
        uint32_t length = payload.size();
        self->outgoing.assign(reinterpret_cast<char *>(&length), sizeof length); self->outgoing += payload; erase(payload);
        if (!self->connect_socket()) return promise;
        self->io = self->watch(self->fd, GIOCondition(G_IO_OUT | G_IO_HUP | G_IO_ERR), [](gint, GIOCondition, gpointer data) -> gboolean {
            auto *self = static_cast<LoginModule *>(data); self->write_request();
            return !self->outgoing.empty() && self->pending ? G_SOURCE_CONTINUE : G_SOURCE_REMOVE;
        }, self);
        GSource *source = g_timeout_source_new_seconds(60);
        g_source_set_callback(source, [](gpointer data) -> gboolean { static_cast<LoginModule *>(data)->fail("greetd did not respond"); return G_SOURCE_REMOVE; }, self, nullptr);
        self->timer = g_source_attach(source, self->context); g_source_unref(source);
        return promise;
    }
    // A user name as greetd would accept it, and safe as a path component.
    static bool valid_user(const std::string &name) {
        if (name.empty() || name.size() > 256 || name[0] == '.' || name[0] == '-') return false;
        for (unsigned char c : name) if (c < 0x20 || c == 0x7f || c == '/') return false;
        return true;
    }
    static std::string state_dir() {
        const char *dir = g_getenv("KOYA_GREETER_STATE_DIR");
        return dir && *dir ? dir : "/var/lib/koya-greeter";
    }
    static std::string state_path() { return state_dir() + "/last-user"; }
    static JSValue last_user(NativeModule *base, int, JSValueConst *) {
        gchar *contents = nullptr; gsize size = 0;
        std::string name;
        if (g_file_get_contents(state_path().c_str(), &contents, &size, nullptr) && size <= 256) name.assign(contents, size);
        g_free(contents);
        while (!name.empty() && (name.back() == '\n' || name.back() == '\r')) name.pop_back();
        return JS_NewString(base->js, valid_user(name) && getpwnam(name.c_str()) ? name.c_str() : "");
    }
    static JSValue remember_user(NativeModule *base, int argc, JSValueConst *argv) {
        if (argc != 1 || !JS_IsString(argv[0])) return JS_ThrowTypeError(base->js, "rememberUser expects a user name");
        const std::string name = string(base->js, argv[0]);
        if (!valid_user(name) || !getpwnam(name.c_str())) return JS_FALSE;
        if (g_mkdir_with_parents(state_dir().c_str(), 0700) != 0) return JS_FALSE;
        return JS_NewBool(base->js, g_file_set_contents(state_path().c_str(), (name + "\n").c_str(), -1, nullptr));
    }
    static std::string account_home(const struct passwd &account) {
        const char *homes = g_getenv("KOYA_LOGIN_HOME_ROOT");
        return homes && *homes ? std::string(homes) + "/" + account.pw_name : account.pw_dir;
    }
    // Read an owned regular file using the account's filesystem identity.
    // Capture the bytes before returning to root-owned cache paths; do not
    // give the renderer an account-controlled path to reopen as root.
    static int account_open(const struct passwd &account, const std::string &path, off_t limit, struct stat &info) {
        const uid_t previous = setfsuid(account.pw_uid);
        const gid_t previousGroup = setfsgid(account.pw_gid);
        int fd = open(path.c_str(), O_RDONLY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC | O_NOCTTY);
        setfsgid(previousGroup); setfsuid(previous);
        if (fd >= 0 && fstat(fd, &info) == 0 && S_ISREG(info.st_mode) && info.st_uid == account.pw_uid && info.st_size >= 0 && info.st_size <= limit) return fd;
        if (fd >= 0) close(fd);
        return -1;
    }
    static std::string account_file(const struct passwd &account, const std::string &path, off_t limit) {
        struct stat info{};
        int fd = account_open(account, path, limit, info);
        if (fd < 0) return "";
        std::string contents;
        contents.resize(info.st_size);
        size_t done = 0;
        while (done < contents.size()) {
            ssize_t count = read(fd, contents.data() + done, contents.size() - done);
            if (count < 0 && errno == EINTR) continue;
            if (count <= 0) break;
            done += count;
        }
        contents.resize(done);
        close(fd);
        return contents;
    }
    // The account's koya-bar settings as JSON text, or null.
    static JSValue user_preferences(NativeModule *base, int argc, JSValueConst *argv) {
        if (argc != 1 || !JS_IsString(argv[0])) return JS_ThrowTypeError(base->js, "userPreferences expects a user name");
        const std::string name = string(base->js, argv[0]);
        struct passwd *account = valid_user(name) ? getpwnam(name.c_str()) : nullptr;
        if (!account || !account->pw_dir || account->pw_dir[0] != '/') return JS_NULL;
        const auto contents = account_file(*account, account_home(*account) + "/.config/koya-bar/settings.json", 64 * 1024);
        return contents.empty() ? JS_NULL : JS_NewStringLen(base->js, contents.data(), contents.size());
    }
    // Publish only the selected, opted-in imported wallpaper's already-rendered
    // PNG in the greeter cache. Its identity matches Wallpapers::entry. Reading
    // it as the account avoids needing its image-decoding service at login.
    static JSValue user_wallpaper(NativeModule *base, int argc, JSValueConst *argv) {
        if (argc != 1 || !JS_IsString(argv[0])) return JS_ThrowTypeError(base->js, "userWallpaper expects a user name");
        const std::string name = string(base->js, argv[0]);
        struct passwd *account = valid_user(name) ? getpwnam(name.c_str()) : nullptr;
        if (!account || !account->pw_dir || account->pw_dir[0] != '/') return JS_NULL;
        const std::string home = account_home(*account);
        const auto settings = account_file(*account, home + "/.config/koya-bar/settings.json", 64 * 1024);
        JSValue parsed = JS_ParseJSON(base->js, settings.data(), settings.size(), "<greeter-wallpaper>");
        if (JS_IsException(parsed)) { JS_FreeValue(base->js, JS_GetException(base->js)); return JS_NULL; }
        if (!JS_IsObject(parsed)) { JS_FreeValue(base->js, parsed); return JS_NULL; }
        JSValue enabled = JS_GetPropertyStr(base->js, parsed, "GreeterWallpaper"), selected = JS_GetPropertyStr(base->js, parsed, "Wallpaper");
        const bool allowed = JS_IsBool(enabled) && JS_ToBool(base->js, enabled) && JS_IsString(selected);
        const std::string id = allowed ? string(base->js, selected) : "";
        JS_FreeValue(base->js, selected); JS_FreeValue(base->js, enabled); JS_FreeValue(base->js, parsed);
        if (!g_str_has_prefix(id.c_str(), "user:")) return JS_NULL;
        const std::string file = id.substr(5);
        if (file.empty() || file[0] == '.' || file.find('/') != std::string::npos || file.find('\\') != std::string::npos) return JS_NULL;
        for (unsigned char c : file) if (c < 0x20 || c == 0x7f) return JS_NULL;
        const std::string source = home + "/.local/share/koya-bar/wallpapers/" + file;
        struct stat sourceInfo{};
        int sourceFd = account_open(*account, source, 64 * 1024 * 1024, sourceInfo);
        if (sourceFd < 0) return JS_NULL;
        close(sourceFd);
        const std::string identity = source + ":" + std::to_string(sourceInfo.st_mtim.tv_sec) + ":"
            + std::to_string(sourceInfo.st_mtim.tv_nsec) + ":" + std::to_string(sourceInfo.st_size);
        gchar *sourceHash = g_compute_checksum_for_string(G_CHECKSUM_SHA256, identity.c_str(), -1);
        const std::string cached = home + "/.cache/koya/wallpapers/koya-wallpaper-" + std::string(sourceHash).substr(0, 24) + ".png";
        g_free(sourceHash);
        const auto contents = account_file(*account, cached, 64 * 1024 * 1024);
        // The desktop cache contains PNGs scaled to at most 3840 pixels per
        // edge. Check the signature and IHDR before exposing its dimensions.
        const unsigned char signature[] = {137, 80, 78, 71, 13, 10, 26, 10};
        if (contents.size() < 33 || memcmp(contents.data(), signature, sizeof signature)
            || memcmp(contents.data() + 12, "IHDR", 4)) return JS_NULL;
        const auto be32 = [&](size_t offset) {
            const auto *bytes = reinterpret_cast<const unsigned char *>(contents.data() + offset);
            return (uint32_t(bytes[0]) << 24) | (uint32_t(bytes[1]) << 16) | (uint32_t(bytes[2]) << 8) | bytes[3];
        };
        const uint32_t width = be32(16), height = be32(20);
        if (be32(8) != 13 || !width || !height || width > 3840 || height > 3840) return JS_NULL;
        gchar *digest = g_compute_checksum_for_data(G_CHECKSUM_SHA256, reinterpret_cast<const guchar *>(contents.data()), contents.size());
        const std::string texture = "koya-greeter-wallpaper-" + std::to_string(account->pw_uid) + "-" + std::string(digest) + ".png";
        g_free(digest);
        const std::string directory = state_dir() + "/wallpapers", target = directory + "/" + texture;
        if (g_mkdir_with_parents(directory.c_str(), 0700) != 0) return JS_NULL;
        if (!g_file_test(target.c_str(), G_FILE_TEST_IS_REGULAR) && !g_file_set_contents(target.c_str(), contents.data(), contents.size(), nullptr)) return JS_NULL;
        JSValue result = JS_NewObject(base->js), wallpaper = JS_NewObject(base->js), size = JS_NewObject(base->js);
        JS_SetPropertyStr(base->js, result, "directory", JS_NewString(base->js, directory.c_str()));
        JS_SetPropertyStr(base->js, wallpaper, "id", JS_NewString(base->js, id.c_str()));
        JS_SetPropertyStr(base->js, wallpaper, "name", JS_NewString(base->js, file.c_str()));
        JS_SetPropertyStr(base->js, wallpaper, "texture", JS_NewString(base->js, ("/rom/" + texture).c_str()));
        JS_SetPropertyStr(base->js, wallpaper, "user", JS_TRUE);
        JS_SetPropertyStr(base->js, size, "x", JS_NewUint32(base->js, width));
        JS_SetPropertyStr(base->js, size, "y", JS_NewUint32(base->js, height));
        JS_SetPropertyStr(base->js, wallpaper, "size", size);
        JS_SetPropertyStr(base->js, result, "wallpaper", wallpaper);
        return result;
    }
    static std::string field(GKeyFile *file, const char *key) {
        gchar *value = g_key_file_get_string(file, "Desktop Entry", key, nullptr);
        std::string result = value ? value : ""; g_free(value); return result;
    }
    static JSValue sessions(NativeModule *base, int, JSValueConst *) {
        JSValue result = JS_NewArray(base->js); unsigned index = 0;
        const char *override = g_getenv("KOYA_LOGIN_SESSION_DIRS");
        gchar **directories = g_strsplit(override ? override : "/usr/local/share/wayland-sessions:/usr/share/wayland-sessions", ":", -1);
        std::set<std::string> seen;
        for (gchar **directory = directories; *directory; ++directory) {
            GDir *dir = g_dir_open(*directory, 0, nullptr); if (!dir) continue;
            while (const char *name = g_dir_read_name(dir)) {
                if (!g_str_has_suffix(name, ".desktop") || !seen.insert(name).second) continue;
                std::string path = std::string(*directory) + "/" + name;
                GKeyFile *file = g_key_file_new();
                if (!g_key_file_load_from_file(file, path.c_str(), G_KEY_FILE_NONE, nullptr)) { g_key_file_unref(file); continue; }
                gchar *title = g_key_file_get_locale_string(file, "Desktop Entry", "Name", nullptr, nullptr);
                std::string command = field(file, "Exec"), try_exec = field(file, "TryExec");
                gchar **args = nullptr; int count = 0;
                bool valid = title && *title && field(file, "Type") == "Application" && !g_key_file_get_boolean(file, "Desktop Entry", "Hidden", nullptr)
                    && !g_key_file_get_boolean(file, "Desktop Entry", "NoDisplay", nullptr) && g_shell_parse_argv(command.c_str(), &count, &args, nullptr) && count > 0;
                gchar *program = g_find_program_in_path(try_exec.empty() && count ? args[0] : try_exec.c_str());
                valid = valid && program; g_free(program);
                std::vector<std::string> expanded;
                for (int i = 0; valid && i < count; ++i) {
                    std::string arg = args[i];
                    if (arg == "%i") { auto icon = field(file, "Icon"); if (!icon.empty()) { expanded.push_back("--icon"); expanded.push_back(icon); } continue; }
                    if (arg.size() == 2 && arg[0] == '%' && strchr("fFuUdDnNvm", arg[1])) continue;
                    std::string value;
                    for (size_t j = 0; j < arg.size(); ++j) {
                        if (arg[j] != '%') { value += arg[j]; continue; }
                        if (++j == arg.size()) { valid = false; break; }
                        if (arg[j] == '%') value += '%'; else if (arg[j] == 'c') value += title;
                        else if (arg[j] == 'k') value += path; else { valid = false; break; }
                    }
                    expanded.push_back(value);
                }
                if (valid && !expanded.empty()) {
                    JSValue entry = JS_NewObject(base->js), cmd = JS_NewArray(base->js), env = JS_NewArray(base->js);
                    JS_SetPropertyStr(base->js, entry, "id", JS_NewString(base->js, name));
                    JS_SetPropertyStr(base->js, entry, "name", JS_NewString(base->js, title));
                    for (unsigned i = 0; i < expanded.size(); ++i) JS_SetPropertyUint32(base->js, cmd, i, JS_NewString(base->js, expanded[i].c_str()));
                    JS_SetPropertyUint32(base->js, env, 0, JS_NewString(base->js, "XDG_SESSION_TYPE=wayland"));
                    auto desktops = field(file, "DesktopNames"); std::replace(desktops.begin(), desktops.end(), ';', ':');
                    while (!desktops.empty() && desktops.back() == ':') desktops.pop_back();
                    if (!desktops.empty()) JS_SetPropertyUint32(base->js, env, 1, JS_NewString(base->js, ("XDG_CURRENT_DESKTOP=" + desktops).c_str()));
                    JS_SetPropertyStr(base->js, entry, "cmd", cmd); JS_SetPropertyStr(base->js, entry, "env", env);
                    JS_SetPropertyUint32(base->js, result, index++, entry);
                }
                g_strfreev(args); g_free(title); g_key_file_unref(file);
            }
            g_dir_close(dir);
        }
        g_strfreev(directories); return result;
    }
};

extern "C" HELIX_PLUGIN_EXPORT int helix_plugin_integrate(JSContext *ctx, const char *name, const HelixPluginHost *host, HelixPluginInstance **out) {
    auto *self = new LoginModule(ctx);
    self->functions = {{"request", LoginModule::request}, {"sessions", LoginModule::sessions},
        {"lastUser", LoginModule::last_user}, {"rememberUser", LoginModule::remember_user}, {"userPreferences", LoginModule::user_preferences},
        {"userWallpaper", LoginModule::user_wallpaper}, {"close", [](NativeModule *base, int, JSValueConst *) {
        static_cast<LoginModule *>(base)->fail("Login connection closed"); return JS_UNDEFINED;
    }}};
    if (self->integrate(name, host, out)) return 0;
    delete self; return 1;
}
