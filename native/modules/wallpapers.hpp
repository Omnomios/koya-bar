#pragma once
#include <gio/gio.h>
#include <glib/gstdio.h>
#include <dlfcn.h>
#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>
#include <string>
#include <vector>
#include <algorithm>

// User wallpapers: images imported into the data directory, rendered once to
// PNG textures (display size and a small thumbnail) in a cache directory that
// the JS side mounts at /rom. GdkPixbuf is loaded on demand, as for icons.
struct Wallpapers {
    const std::string data = std::string(g_get_user_data_dir()) + "/koya-bar/wallpapers";
    const std::string cache = std::string(g_get_user_cache_dir()) + "/koya/wallpapers";
    static constexpr int FULL = 3840, THUMB = 512;

    struct Pixbuf {
        void *library = dlopen("libgdk_pixbuf-2.0.so.0", RTLD_LAZY | RTLD_LOCAL);
        void *(*info)(const char *, int *, int *) = nullptr;
        void *(*load)(const char *, int, int, gboolean, GError **) = nullptr;
        void *(*orient)(void *) = nullptr;
        int (*width)(void *) = nullptr, (*height)(void *) = nullptr;
        gboolean (*save)(void *, const char *, const char *, char **, char **, GError **) = nullptr;
        Pixbuf() {
            if (!library) return;
            info = reinterpret_cast<decltype(info)>(dlsym(library, "gdk_pixbuf_get_file_info"));
            load = reinterpret_cast<decltype(load)>(dlsym(library, "gdk_pixbuf_new_from_file_at_scale"));
            orient = reinterpret_cast<decltype(orient)>(dlsym(library, "gdk_pixbuf_apply_embedded_orientation"));
            width = reinterpret_cast<decltype(width)>(dlsym(library, "gdk_pixbuf_get_width"));
            height = reinterpret_cast<decltype(height)>(dlsym(library, "gdk_pixbuf_get_height"));
            save = reinterpret_cast<decltype(save)>(dlsym(library, "gdk_pixbuf_savev"));
        }
        bool ready() const { return info && load && width && height && save; }
    };
    static Pixbuf &pixbuf() { static Pixbuf instance; return instance; }

    static bool exists(const std::string &path) { struct stat status{}; return !stat(path.c_str(), &status); }
    static std::string quote(const std::string &text) {
        std::string result = "\"";
        for (unsigned char c : text) {
            if (c == '"' || c == '\\') { result += '\\'; result += c; }
            else if (c < 32) { char escaped[7]; snprintf(escaped, sizeof escaped, "\\u%04x", c); result += escaped; }
            else result += c;
        }
        return result + '"';
    }
    // A loadable image that GdkPixbuf recognises, by content rather than name.
    static bool image(const std::string &path) {
        auto &pb = pixbuf(); int w = 0, h = 0;
        return pb.ready() && pb.info(path.c_str(), &w, &h) && w > 0 && h > 0;
    }
    // Scale down (never up) to fit `edge`, honour EXIF orientation, write PNG atomically.
    static bool render(const std::string &source, const std::string &target, int edge) {
        auto &pb = pixbuf(); if (!pb.ready()) return false;
        int w = 0, h = 0; if (!pb.info(source.c_str(), &w, &h) || w <= 0 || h <= 0) return false;
        const bool shrink = std::max(w, h) > edge;
        GError *error = nullptr;
        void *loaded = pb.load(source.c_str(), shrink ? edge : -1, shrink ? edge : -1, true, &error);
        g_clear_error(&error);
        if (!loaded) return false;
        void *picture = pb.orient ? pb.orient(loaded) : loaded;
        if (picture != loaded) g_object_unref(loaded);
        if (!picture) return false;
        std::string temporary = target + ".tmpXXXXXX";
        int fd = g_mkstemp_full(temporary.data(), O_RDWR | O_CLOEXEC, 0600);
        bool ok = false;
        if (fd >= 0) {
            close(fd);
            ok = pb.save(picture, temporary.c_str(), "png", nullptr, nullptr, &error) && !g_rename(temporary.c_str(), target.c_str());
            if (!ok) g_unlink(temporary.c_str());
        }
        g_clear_error(&error); g_object_unref(picture);
        return ok;
    }
    // Ensure both textures exist for an imported file; returns its JSON entry or "".
    std::string entry(const std::string &file) {
        const std::string path = data + "/" + file;
        struct stat status{}; if (stat(path.c_str(), &status) || !S_ISREG(status.st_mode)) return "";
        std::string identity = path + ":" + std::to_string(status.st_mtim.tv_sec) + ":" + std::to_string(status.st_mtim.tv_nsec) + ":" + std::to_string(status.st_size);
        gchar *hash = g_compute_checksum_for_string(G_CHECKSUM_SHA256, identity.c_str(), -1);
        const std::string stem = std::string("koya-wallpaper-") + std::string(hash).substr(0, 24); g_free(hash);
        const std::string full = cache + "/" + stem + ".png", thumb = cache + "/" + stem + "-thumb.png";
        if (!exists(full) && !render(path, full, FULL)) return "";
        if (!exists(thumb) && !render(full, thumb, THUMB)) return "";
        int w = 0, h = 0, tw = 0, th = 0; auto &pb = pixbuf();
        if (!pb.info(full.c_str(), &w, &h) || !pb.info(thumb.c_str(), &tw, &th)) return "";
        std::string name = file.substr(0, file.rfind('.') == std::string::npos ? file.size() : file.rfind('.'));
        std::replace(name.begin(), name.end(), '_', ' '); std::replace(name.begin(), name.end(), '-', ' ');
        return "{\"id\":" + quote("user:" + file) + ",\"name\":" + quote(name) + ",\"texture\":" + quote("/rom/" + stem + ".png")
            + ",\"thumbnail\":" + quote("/rom/" + stem + "-thumb.png") + ",\"size\":{\"x\":" + std::to_string(w) + ",\"y\":" + std::to_string(h) + "},\"thumbnailSize\":{\"x\":" + std::to_string(tw) + ",\"y\":" + std::to_string(th) + "},\"user\":true}";
    }
    std::string list() {
        g_mkdir_with_parents(data.c_str(), 0700); g_mkdir_with_parents(cache.c_str(), 0700);
        std::vector<std::string> files;
        if (GDir *dir = g_dir_open(data.c_str(), 0, nullptr)) {
            while (const char *name = g_dir_read_name(dir)) if (name[0] != '.') files.emplace_back(name);
            g_dir_close(dir);
        }
        std::sort(files.begin(), files.end());
        std::string result = "[";
        for (const auto &file : files) {
            std::string item = entry(file);
            if (item.empty()) continue;
            if (result.size() > 1) result += ',';
            result += item;
        }
        return result + "]";
    }
    // Copy an image (path or file:// URI) into the data directory under a free name.
    std::string import(const std::string &source, std::string &error) {
        std::string path = source;
        if (g_str_has_prefix(source.c_str(), "file://")) {
            gchar *local = g_filename_from_uri(source.c_str(), nullptr, nullptr);
            if (!local) { error = "Not a local file"; return ""; }
            path = local; g_free(local);
        }
        if (!image(path)) { error = "Not a supported image"; return ""; }
        g_mkdir_with_parents(data.c_str(), 0700); g_mkdir_with_parents(cache.c_str(), 0700);
        gchar *base = g_path_get_basename(path.c_str());
        std::string name = base; g_free(base);
        const auto dot = name.rfind('.');
        const std::string stem = dot == std::string::npos ? name : name.substr(0, dot), extension = dot == std::string::npos ? "" : name.substr(dot);
        for (int n = 2; exists(data + "/" + name); ++n) name = stem + "-" + std::to_string(n) + extension;
        GFile *from = g_file_new_for_path(path.c_str()), *to = g_file_new_for_path((data + "/" + name).c_str());
        GError *failure = nullptr;
        bool copied = g_file_copy(from, to, G_FILE_COPY_NONE, nullptr, nullptr, nullptr, &failure);
        if (!copied) error = failure ? failure->message : "Cannot copy image";
        g_clear_error(&failure); g_object_unref(from); g_object_unref(to);
        if (!copied) return "";
        std::string item = entry(name);
        if (item.empty()) { g_unlink((data + "/" + name).c_str()); error = "Cannot render image"; }
        return item;
    }
    bool remove(const std::string &id) {
        if (!g_str_has_prefix(id.c_str(), "user:")) return false;
        const std::string file = id.substr(5);
        if (file.empty() || file.find('/') != std::string::npos || file[0] == '.') return false;
        return !g_unlink((data + "/" + file).c_str());
    }
};
