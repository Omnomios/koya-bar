#pragma once
#include <glib.h>
#include <pty.h>
#include <poll.h>
#include <signal.h>
#include <sys/wait.h>
#include <unistd.h>
#include <algorithm>
#include <cerrno>
#include <cstring>
#include <string>

// Changes the signed-in account's password the way the system does it for a
// person at a terminal: /usr/bin/passwd (setuid) on a pseudo-terminal. passwd
// checks the current password and applies the system's PAM rules (quality,
// history); nothing needs administrator approval. Prompts are read in the C
// locale. A refusal is reported in passwd's own words, and which field it
// concerns ("current" or "next"). Runs on a worker thread; blocks until passwd
// is done or 30 seconds pass.
namespace Passwords {
struct Outcome { bool ok = false; std::string message, field; };

inline void erase(std::string &value) { explicit_bzero(value.data(), value.size()); value.clear(); }

inline std::string lower(std::string value) {
    for (auto &c : value) c = g_ascii_tolower(c);
    return value;
}

inline Outcome change(std::string current, std::string next) {
    Outcome outcome;
    const char *program = g_getenv("KOYA_PASSWD");
    int master = -1;
    const pid_t pid = forkpty(&master, nullptr, nullptr, nullptr);
    if (pid < 0) { erase(current); erase(next); outcome.message = "Could not start passwd"; return outcome; }
    if (pid == 0) {
        setenv("LC_ALL", "C", 1); setenv("LANGUAGE", "C", 1);
        const char *path = program && *program ? program : "/usr/bin/passwd";
        execl(path, "passwd", static_cast<char *>(nullptr));
        _exit(127);
    }
    // Everything passwd printed, and how much of it has been answered.
    std::string output, said;
    size_t answered = 0;
    int newPrompts = 0;
    bool sentCurrent = false, stopped = false;
    const gint64 deadline = g_get_monotonic_time() + 30 * G_USEC_PER_SEC;
    auto send = [&](const std::string &value) {
        std::string line = value + "\n";
        for (size_t done = 0; done < line.size();) {
            const ssize_t count = write(master, line.data() + done, line.size() - done);
            if (count < 0 && errno == EINTR) continue;
            if (count <= 0) break;
            done += count;
        }
        erase(line);
    };
    for (;;) {
        const gint64 left = (deadline - g_get_monotonic_time()) / 1000;
        if (left <= 0) { outcome.message = "passwd did not respond"; stopped = true; break; }
        pollfd watch{master, POLLIN, 0};
        const int ready = poll(&watch, 1, static_cast<int>(std::min<gint64>(left, 1000)));
        if (ready < 0 && errno == EINTR) continue;
        if (ready <= 0) continue;
        char buffer[512];
        const ssize_t count = read(master, buffer, sizeof buffer);
        if (count <= 0) break;   // EIO: passwd closed the terminal
        output.append(buffer, count);
        // Answer the newest prompt once: a line ending in ':' with nothing after.
        const std::string fresh = lower(output.substr(answered));
        const size_t colon = fresh.find_last_of(':');
        if (colon == std::string::npos || fresh.find_first_not_of(" \t", colon + 1) != std::string::npos) continue;
        const size_t start = fresh.find_last_of("\r\n", colon);
        const size_t from = start == std::string::npos ? 0 : start + 1;
        const std::string prompt = fresh.substr(from, colon - from);
        answered = output.size();
        if (prompt.find("retype") != std::string::npos || prompt.find("again") != std::string::npos) send(next);
        else if (prompt.find("new") != std::string::npos) {
            // A second request for the new password means it was refused.
            if (++newPrompts > 1) { stopped = true; outcome.field = "next"; break; }
            send(next);
        } else if (prompt.find("password") != std::string::npos && !sentCurrent) { sentCurrent = true; send(current); }
        else { stopped = true; break; }
    }
    erase(current); erase(next);
    if (stopped) kill(pid, SIGTERM);
    int status = 0;
    while (waitpid(pid, &status, 0) < 0 && errno == EINTR) {}
    close(master);
    outcome.ok = !stopped && WIFEXITED(status) && WEXITSTATUS(status) == 0;
    if (!outcome.ok && outcome.message.empty()) {
        // passwd's own explanation: a BAD PASSWORD line, or its last word.
        const std::string text = lower(output);
        const size_t bad = text.find("bad password:");
        if (bad != std::string::npos) {
            const size_t end = output.find_first_of("\r\n", bad);
            std::string reason = output.substr(bad + 13, end == std::string::npos ? std::string::npos : end - bad - 13);
            const size_t first = reason.find_first_not_of(" \t"), last = reason.find_last_not_of(" \t");
            outcome.message = first == std::string::npos ? "" : reason.substr(first, last - first + 1);
            if (!outcome.message.empty()) outcome.message[0] = g_ascii_toupper(outcome.message[0]);
            outcome.field = "next";
        } else if (text.find("authentication token manipulation") != std::string::npos || text.find("authentication failure") != std::string::npos) {
            outcome.message = "The current password is incorrect"; outcome.field = "current";
        } else if (text.find("do not match") != std::string::npos) {
            outcome.message = "The new passwords differ"; outcome.field = "next";
        } else outcome.message = "Could not change the password";
    }
    explicit_bzero(output.data(), output.size());
    return outcome;
}
}
