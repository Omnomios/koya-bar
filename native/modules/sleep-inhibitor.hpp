#pragma once
#include <gio/gunixfdlist.h>
#include <cstdint>
#include <mutex>
#include <string>
#include <unistd.h>

// login1.Inhibit returns a UNIX FD, not a cookie or an integer that JS can
// safely retain. Own its duplicate here and close it to release the lock.
struct SleepInhibitor {
    std::mutex mutex;
    uint64_t generation = 0;
    int fd = -1;
    GCancellable *cancellation = nullptr;
    ~SleepInhibitor() { release(); }
    uint64_t begin() {
        std::lock_guard<std::mutex> lock(mutex);
        if (cancellation) g_cancellable_cancel(cancellation);
        g_clear_object(&cancellation);
        cancellation = g_cancellable_new();
        return ++generation;
    }
    void release() {
        std::lock_guard<std::mutex> lock(mutex);
        ++generation;
        if (cancellation) g_cancellable_cancel(cancellation);
        g_clear_object(&cancellation);
        if (fd >= 0) close(fd);
        fd = -1;
    }
    // Runs on DesktopModule's worker. Cancellation also covers requests that
    // are still queued and replies that arrive after the user switches off.
    bool acquire(uint64_t request, std::string &message) {
        GCancellable *cancel;
        {
            std::lock_guard<std::mutex> lock(mutex);
            if (request != generation || !cancellation) { message = "Caffeine request cancelled"; return false; }
            if (fd >= 0) return true;
            cancel = G_CANCELLABLE(g_object_ref(cancellation));
        }
        GError *error = nullptr;
        GDBusConnection *bus = g_bus_get_sync(G_BUS_TYPE_SYSTEM, cancel, &error);
        GUnixFDList *fds = nullptr;
        GVariant *reply = bus ? g_dbus_connection_call_with_unix_fd_list_sync(bus,
            "org.freedesktop.login1", "/org/freedesktop/login1", "org.freedesktop.login1.Manager", "Inhibit",
            g_variant_new("(ssss)", "sleep:idle", "Koya Bar", "Caffeine keeps the computer awake", "block"),
            G_VARIANT_TYPE("(h)"), G_DBUS_CALL_FLAGS_NONE, 5000, nullptr, &fds, cancel, &error) : nullptr;
        int received = -1;
        if (reply && fds) {
            gint32 index;
            g_variant_get(reply, "(h)", &index);
            received = g_unix_fd_list_get(fds, index, &error);
        }
        if (reply) g_variant_unref(reply);
        g_clear_object(&fds);
        g_clear_object(&bus);
        {
            std::lock_guard<std::mutex> lock(mutex);
            if (request != generation || g_cancellable_is_cancelled(cancel)) {
                if (received >= 0) close(received);
                message = "Caffeine request cancelled";
            } else if (received < 0) message = error ? error->message : "logind did not return an inhibitor descriptor";
            else fd = received;
        }
        g_clear_error(&error);
        g_object_unref(cancel);
        return message.empty();
    }
};
