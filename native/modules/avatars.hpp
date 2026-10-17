#pragma once
#include "wallpapers.hpp"

// AccountsService expects PNG. Prepare a small square portrait on the desktop
// worker, so choosing a JPEG or a large photograph never blocks the UI.
struct Avatars {
    static std::string prepare(const std::string &source, std::string &error) {
        std::string path = source;
        if (g_str_has_prefix(source.c_str(), "file://")) {
            gchar *local = g_filename_from_uri(source.c_str(), nullptr, nullptr);
            if (!local) { error = "Not a local image"; return {}; }
            path = local; g_free(local);
        }
        struct stat status{};
        if (path.empty() || path.find('\0') != std::string::npos || stat(path.c_str(), &status)
            || !S_ISREG(status.st_mode) || status.st_size > 64 * 1024 * 1024) {
            error = "Choose an image file smaller than 64 MB"; return {};
        }
        auto &pb = Wallpapers::pixbuf();
        auto crop = reinterpret_cast<void *(*)(void *, int, int, int, int)>(dlsym(pb.library, "gdk_pixbuf_new_subpixbuf"));
        auto scale = reinterpret_cast<void *(*)(void *, int, int, int)>(dlsym(pb.library, "gdk_pixbuf_scale_simple"));
        if (!pb.ready() || !crop || !scale || !Wallpapers::image(path)) { error = "Not a supported image"; return {}; }
        GError *failure = nullptr;
        void *loaded = pb.load(path.c_str(), 1024, 1024, true, &failure);
        g_clear_error(&failure);
        if (!loaded) { error = "Cannot read this image"; return {}; }
        void *portrait = pb.orient ? pb.orient(loaded) : loaded;
        if (portrait != loaded) g_object_unref(loaded);
        if (!portrait) { error = "Cannot read this image"; return {}; }
        int w = pb.width(portrait), h = pb.height(portrait), edge = std::min(w, h);
        void *square = crop(portrait, (w - edge) / 2, (h - edge) / 2, edge, edge);
        void *avatar = square ? scale(square, 256, 256, 2 /* bilinear */) : nullptr;
        if (square) g_object_unref(square);
        g_object_unref(portrait);
        if (!avatar) { error = "Cannot prepare this image"; return {}; }
        const std::string directory = std::string(g_get_user_cache_dir()) + "/koya/account";
        const std::string target = directory + "/avatar.png";
        std::string temporary = target + ".tmpXXXXXX";
        int fd = g_mkdir_with_parents(directory.c_str(), 0700) == 0 ? g_mkstemp_full(temporary.data(), O_RDWR | O_CLOEXEC, 0600) : -1;
        bool saved = false;
        if (fd >= 0) {
            close(fd);
            saved = pb.save(avatar, temporary.c_str(), "png", nullptr, nullptr, &failure) && !g_rename(temporary.c_str(), target.c_str());
            if (!saved) g_unlink(temporary.c_str());
        }
        g_clear_error(&failure); g_object_unref(avatar);
        if (!saved) { error = "Cannot save this image"; return {}; }
        return target;
    }
};
