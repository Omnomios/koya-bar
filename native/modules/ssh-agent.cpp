// OpenSSH socket proxy plus its askpass transport. No private key parsing or store.
#include <gio/gio.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <sys/file.h>
#include <sys/stat.h>
#include <sys/prctl.h>
#include <sys/resource.h>
#include <poll.h>
#include <signal.h>
#include <unistd.h>
#include <fcntl.h>
#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstring>
#include <fstream>
#include <iostream>
#include <map>
#include <memory>
#include <algorithm>
#include <mutex>
#include <set>
#include <sstream>
#include <thread>
#include <vector>

using Bytes = std::vector<unsigned char>;
constexpr size_t MAX_PACKET = 1024 * 1024, MAX_SECRET = 4096, MAX_PROMPT = 8192;
static volatile sig_atomic_t interrupted = 0;
static void wipe(void *data, size_t size) { explicit_bzero(data, size); }
struct Fd {
    int value = -1;
    explicit Fd(int fd = -1): value(fd) {}
    ~Fd() { if (value >= 0) close(value); }
    Fd(const Fd&) = delete;
};
static bool transfer(int fd, void *data, size_t size, bool writing) {
    auto *p = static_cast<unsigned char *>(data);
    while (size) {
        ssize_t count = writing ? send(fd, p, size, MSG_NOSIGNAL) : recv(fd, p, size, 0);
        if (count < 0 && errno == EINTR && !interrupted) continue;
        if (count <= 0) return false;
        p += count; size -= count;
    }
    return true;
}
static uint32_t number(const unsigned char *p) { return uint32_t(p[0]) << 24 | uint32_t(p[1]) << 16 | uint32_t(p[2]) << 8 | p[3]; }
static void append_number(Bytes &data, uint32_t n) { for (int s : {24,16,8,0}) data.push_back((n >> s) & 255); }
static bool packet(int fd, Bytes &data, size_t limit = MAX_PACKET) {
    unsigned char length[4]; if (!transfer(fd, length, 4, false)) return false;
    size_t size = number(length); if (!size || size > limit) return false;
    data.resize(size); return transfer(fd, data.data(), size, false);
}
static bool send_packet(int fd, const Bytes &data) {
    Bytes frame; append_number(frame, data.size()); frame.insert(frame.end(), data.begin(), data.end());
    bool ok = transfer(fd, frame.data(), frame.size(), true); wipe(frame.data(), frame.size()); return ok;
}
static bool field(const Bytes &data, size_t &at, Bytes &value) {
    if (at + 4 > data.size()) return false;
    size_t size = number(data.data() + at); at += 4;
    if (size > data.size() - at) return false;
    value.assign(data.begin() + at, data.begin() + at + size); at += size; return true;
}
static void append_field(Bytes &data, const Bytes &value) { append_number(data, value.size()); data.insert(data.end(), value.begin(), value.end()); }
static int connect_socket(const std::string &path) {
    if (path.empty() || path.size() >= sizeof(sockaddr_un::sun_path)) return -1;
    Fd fd(socket(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC | SOCK_NONBLOCK, 0)); if (fd.value < 0) return -1;
    sockaddr_un address{}; address.sun_family = AF_UNIX; memcpy(address.sun_path, path.c_str(), path.size() + 1);
    if (connect(fd.value, reinterpret_cast<sockaddr *>(&address), sizeof address) < 0) {
        if (errno != EINPROGRESS) return -1;
        pollfd ready{fd.value, POLLOUT, 0}; int error = 0; socklen_t size = sizeof error;
        if (poll(&ready, 1, 5000) <= 0 || getsockopt(fd.value, SOL_SOCKET, SO_ERROR, &error, &size) < 0 || error) return -1;
    }
    if (fcntl(fd.value, F_SETFL, fcntl(fd.value, F_GETFL) & ~O_NONBLOCK) < 0) return -1;
    int result = fd.value; fd.value = -1; return result;
}
static bool same_user(int fd) {
    ucred peer{}; socklen_t size = sizeof peer;
    return getsockopt(fd, SOL_SOCKET, SO_PEERCRED, &peer, &size) == 0 && peer.uid == geteuid();
}
static int listen_socket(const std::string &path) {
    if (path.empty() || path.size() >= sizeof(sockaddr_un::sun_path)) return -1;
    struct stat old{};
    if (lstat(path.c_str(), &old) == 0) {
        if (!S_ISSOCK(old.st_mode) || old.st_uid != geteuid() || unlink(path.c_str()) < 0) return -1;
    }
    Fd fd(socket(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0)); if (fd.value < 0) return -1;
    sockaddr_un address{}; address.sun_family = AF_UNIX; memcpy(address.sun_path, path.c_str(), path.size() + 1);
    if (bind(fd.value, reinterpret_cast<sockaddr *>(&address), sizeof address) < 0 || chmod(path.c_str(), 0600) < 0 || listen(fd.value, 16) < 0) return -1;
    int result = fd.value; fd.value = -1; return result;
}
static std::string escape(const std::string &value) {
    char *encoded = g_uri_escape_string(value.c_str(), nullptr, FALSE);
    std::string result = encoded ? encoded : ""; g_free(encoded); return result;
}
struct Key { Bytes blob; std::string path, comment; };
struct Prompt {
    std::condition_variable wake;
    bool done = false, accepted = false;
    std::string answer;
    ~Prompt() { wipe(answer.data(), answer.size()); }
};
struct Server {
    std::string agent_socket, prompt_socket, upstream, directory, program, helper;
    std::mutex mutex, output_mutex, loading;
    std::atomic<bool> stopped{false}, agent_locked{false};
    std::set<int> descriptors;
    std::set<GSubprocess *> children;
    std::map<unsigned, std::shared_ptr<Prompt>> prompts;
    unsigned serial = 0;
    void event(const std::string &line) { std::lock_guard<std::mutex> lock(output_mutex); std::cout << line << '\n' << std::flush; }
    bool track(int fd) {
        std::lock_guard<std::mutex> lock(mutex);
        if (stopped) return false;
        descriptors.insert(fd); return true;
    }
    void untrack(int fd) { std::lock_guard<std::mutex> lock(mutex); descriptors.erase(fd); }
    std::vector<Key> keys() {
        std::vector<Key> result;
        GDir *dir = g_dir_open(directory.c_str(), 0, nullptr); if (!dir) return result;
        while (const char *name = g_dir_read_name(dir)) {
            std::string filename(name);
            if (filename.size() < 5 || filename.substr(filename.size() - 4) != ".pub") continue;
            std::string path = directory + "/" + filename.substr(0, filename.size() - 4);
            struct stat info{};
            if (stat(path.c_str(), &info) != 0 || !S_ISREG(info.st_mode) || info.st_uid != geteuid()) continue;
            if (stat((path + ".pub").c_str(), &info) != 0 || !S_ISREG(info.st_mode) || info.st_size > 65536) continue;
            std::ifstream file(path + ".pub"); std::string type, encoded, comment;
            if (!(file >> type >> encoded) || encoded.size() > MAX_PACKET) continue;
            std::getline(file, comment); if (!comment.empty() && comment.front() == ' ') comment.erase(0,1);
            gsize size = 0; guchar *raw = g_base64_decode(encoded.c_str(), &size);
            Bytes blob(raw, raw + size); g_free(raw); size_t at = 0; Bytes key_type;
            if (!field(blob, at, key_type) || std::string(key_type.begin(), key_type.end()) != type || blob.size() > MAX_PACKET / 2) continue;
            result.push_back({std::move(blob), path, comment.empty() ? filename : comment});
        }
        g_dir_close(dir); return result;
    }
    bool identities_valid(const Bytes &identities) {
        if (identities.size() < 5 || identities[0] != 12) return false;
        size_t at = 5; Bytes blob, comment;
        const uint32_t count = number(identities.data() + 1);
        if (count > MAX_PACKET / 8) return false;
        for (uint32_t i = 0; i < count; ++i)
            if (!field(identities, at, blob) || !field(identities, at, comment)) return false;
        return at == identities.size();
    }
    bool loaded(const Bytes &identities, const Bytes &key) {
        if (!identities_valid(identities)) return false;
        size_t at = 5; Bytes blob, comment;
        for (uint32_t i = 0; i < number(identities.data() + 1); ++i) {
            field(identities, at, blob); field(identities, at, comment);
            if (blob == key) return true;
        }
        return false;
    }
    bool query(int fd, const Bytes &request, Bytes &response) { return send_packet(fd, request) && packet(fd, response); }
    void augment(Bytes &identities) {
        if (agent_locked || !identities_valid(identities)) return;
        const Bytes original = identities; uint32_t count = number(original.data() + 1);
        std::set<Bytes> added;
        for (const auto &key : keys()) {
            if (loaded(original, key.blob) || !added.insert(key.blob).second) continue;
            Bytes comment(key.comment.begin(), key.comment.end());
            if (identities.size() + key.blob.size() + comment.size() + 8 > MAX_PACKET) break;
            append_field(identities, key.blob); append_field(identities, comment); ++count;
        }
        for (int i = 0; i < 4; ++i) identities[i + 1] = (count >> (24 - i * 8)) & 255;
    }
    bool add(const std::string &path, int client) {
        if (stopped) return false;
        GSubprocessLauncher *launcher = g_subprocess_launcher_new(static_cast<GSubprocessFlags>(G_SUBPROCESS_FLAGS_STDIN_PIPE | G_SUBPROCESS_FLAGS_STDOUT_SILENCE | G_SUBPROCESS_FLAGS_STDERR_SILENCE));
        g_subprocess_launcher_setenv(launcher, "SSH_AUTH_SOCK", upstream.c_str(), TRUE);
        g_subprocess_launcher_setenv(launcher, "SSH_ASKPASS", helper.c_str(), TRUE);
        g_subprocess_launcher_setenv(launcher, "SSH_ASKPASS_REQUIRE", "force", TRUE);
        g_subprocess_launcher_setenv(launcher, "KOYA_SSH_ASKPASS", "1", TRUE);
        g_subprocess_launcher_setenv(launcher, "KOYA_SSH_PROMPT_SOCKET", prompt_socket.c_str(), TRUE);
        g_subprocess_launcher_setenv(launcher, "LC_ALL", "C", TRUE);
        const char *argv[] = {program.c_str(), "--", path.c_str(), nullptr};
        GError *error = nullptr;
        GSubprocess *child;
        {
            std::lock_guard<std::mutex> lock(mutex);
            child = stopped ? nullptr : g_subprocess_launcher_spawnv(launcher, argv, &error);
            if (child) children.insert(child);
        }
        g_object_unref(launcher); g_clear_error(&error);
        if (!child) return false;
        g_output_stream_close(g_subprocess_get_stdin_pipe(child), nullptr, nullptr);
        std::atomic<bool> finished{false}; bool ok = false;
        std::thread waiter([&] { ok = g_subprocess_wait_check(child, nullptr, &error); finished = true; });
        const auto deadline = std::chrono::steady_clock::now() + std::chrono::minutes(5);
        while (!finished) {
            unsigned char peek;
            const ssize_t state = recv(client, &peek, 1, MSG_PEEK | MSG_DONTWAIT);
            if (stopped || state == 0 || (state < 0 && errno != EAGAIN && errno != EWOULDBLOCK && errno != EINTR) ||
                std::chrono::steady_clock::now() >= deadline) { g_subprocess_force_exit(child); break; }
            std::this_thread::sleep_for(std::chrono::milliseconds(100));
        }
        waiter.join(); g_clear_error(&error);
        { std::lock_guard<std::mutex> lock(mutex); children.erase(child); }
        g_object_unref(child); return ok;
    }
    void agent_client(int fd) {
        Fd remote(connect_socket(upstream)); if (remote.value < 0 || !same_user(remote.value) || !track(remote.value)) return;
        Bytes request, response;
        while (!stopped && packet(fd, request)) {
            bool ok = true, handled = false;
            if (request[0] == 22 || request[0] == 23) {
                std::lock_guard<std::mutex> one(loading);
                ok = query(remote.value, request, response); handled = true;
                if (ok && response == Bytes{6}) agent_locked = request[0] == 22;
            }
            if (request[0] == 13) {
                size_t at = 1; Bytes blob, data;
                if (!field(request, at, blob) || !field(request, at, data) || request.size() - at != 4) {
                    send_packet(fd, Bytes{5}); wipe(request.data(), request.size()); request.clear(); continue;
                }
                // Never replace a loaded key: preserve its confirmation/destination constraints.
                std::lock_guard<std::mutex> one(loading);
                Bytes identities;
                ok = !stopped && query(remote.value, Bytes{11}, identities);
                if (ok && !agent_locked && identities_valid(identities) && !loaded(identities, blob)) {
                    for (const auto &key : keys()) if (key.blob == blob) { add(key.path, fd); break; }
                }
            }
            if (!ok || (!handled && !query(remote.value, request, response))) break;
            if (request[0] == 11) augment(response);
            if (!send_packet(fd, response)) break;
            // ADD_IDENTITY carries private key material; do not retain packet buffers.
            wipe(request.data(), request.size()); request.clear();
        }
        wipe(request.data(), request.size()); untrack(remote.value);
    }
    void prompt_client(int fd) {
        Bytes message; if (!packet(fd, message, MAX_PROMPT) || message[0] != 1) return;
        std::string text(message.begin() + 1, message.end());
        if (!g_utf8_validate(text.data(), text.size(), nullptr) || text.find('\0') != std::string::npos) return;
        auto prompt = std::make_shared<Prompt>(); unsigned id;
        { std::lock_guard<std::mutex> lock(mutex); if (stopped || prompts.size() >= 16) return; id = ++serial; prompts[id] = prompt; }
        event("P " + std::to_string(id) + " " + escape(text));
        const auto deadline = std::chrono::steady_clock::now() + std::chrono::minutes(3);
        {
            std::unique_lock<std::mutex> lock(mutex);
            while (!prompt->done && !stopped && std::chrono::steady_clock::now() < deadline) {
                prompt->wake.wait_for(lock, std::chrono::milliseconds(200));
                pollfd peer{fd, POLLIN | POLLHUP, 0};
                if (poll(&peer, 1, 0) > 0 && peer.revents) break;
            }
            prompts.erase(id);
        }
        Bytes response{static_cast<unsigned char>(prompt->done && prompt->accepted && !stopped ? 0 : 1)};
        if (response[0] == 0) response.insert(response.end(), prompt->answer.begin(), prompt->answer.end());
        send_packet(fd, response); wipe(response.data(), response.size());
        event("D " + std::to_string(id));
    }
    void answer(std::string &line) {
        if (line.size() < 3 || line[1] != ' ' || (line[0] != 'R' && line[0] != 'C')) return;
        char *end = nullptr; const unsigned long parsed = strtoul(line.c_str() + 2, &end, 10);
        if (end == line.c_str() + 2 || parsed == 0 || parsed > UINT32_MAX || (*end && *end != ' ')) return;
        const char op = line[0]; const unsigned id = parsed;
        const char *encoded = *end == ' ' ? end + 1 : end;
        std::lock_guard<std::mutex> lock(mutex);
        auto entry = prompts.find(id); if (entry == prompts.end() || entry->second->done) return;
        char *decoded = op == 'R' ? g_uri_unescape_string(encoded, nullptr) : nullptr;
        if (decoded && strlen(decoded) <= MAX_SECRET && !strpbrk(decoded, "\r\n")) {
            entry->second->answer = decoded; entry->second->accepted = true;
        }
        if (decoded) { wipe(decoded, strlen(decoded)); g_free(decoded); }
        entry->second->done = true; entry->second->wake.notify_one();
    }
    void stop() {
        stopped = true;
        std::lock_guard<std::mutex> lock(mutex);
        for (int fd : descriptors) shutdown(fd, SHUT_RDWR);
        for (auto *child : children) g_subprocess_force_exit(child);
        for (auto &entry : prompts) entry.second->wake.notify_one();
    }
};
static int askpass(const char *prompt) {
    const char *path = getenv("KOYA_SSH_PROMPT_SOCKET"); Fd fd(connect_socket(path ? path : ""));
    if (fd.value < 0 || !same_user(fd.value)) return 1;
    Bytes request{1}; const std::string text = prompt ? prompt : "Enter SSH key passphrase";
    request.insert(request.end(), text.begin(), text.end());
    Bytes response;
    if (request.size() > MAX_PROMPT || !send_packet(fd.value, request) || !packet(fd.value, response, MAX_SECRET + 1) || response[0] != 0) {
        wipe(response.data(), response.size()); return 1;
    }
    response.push_back('\n');
    const unsigned char *p = response.data() + 1; size_t left = response.size() - 1;
    while (left) { ssize_t count = write(STDOUT_FILENO, p, left); if (count <= 0) break; p += count; left -= count; }
    wipe(response.data(), response.size()); return left ? 1 : 0;
}
int main(int argc, char **argv) {
    umask(0077); signal(SIGPIPE, SIG_IGN);
    // The transport temporarily handles passphrases and ADD_IDENTITY packets.
    const rlimit no_core{0, 0}; setrlimit(RLIMIT_CORE, &no_core); prctl(PR_SET_DUMPABLE, 0);
    const pid_t parent = getppid(); prctl(PR_SET_PDEATHSIG, SIGTERM); if (getppid() != parent) return 1;
    if (getenv("KOYA_SSH_ASKPASS")) return askpass(argc > 1 ? argv[1] : nullptr);
    if (argc % 2 != 1) return 2;
    Server server;
    char *self = realpath(argv[0], nullptr); if (!self) return 1; server.helper = self; free(self);
    for (int i = 1; i + 1 < argc; i += 2) {
        std::string name = argv[i], value = argv[i + 1];
        if (name == "--agent-socket") server.agent_socket = value;
        else if (name == "--prompt-socket") server.prompt_socket = value;
        else if (name == "--upstream") server.upstream = value;
        else if (name == "--key-dir") server.directory = value;
        else if (name == "--ssh-add") server.program = value;
        else return 2;
    }
    if (server.agent_socket.empty() || server.prompt_socket.empty() || server.upstream.empty() || server.directory.empty() || server.agent_socket == server.upstream) return 2;
    if (server.program.empty()) server.program = "/usr/bin/ssh-add";
    const std::string folder = server.agent_socket.substr(0, server.agent_socket.find_last_of('/'));
    if (server.prompt_socket.substr(0, server.prompt_socket.find_last_of('/')) != folder ||
        server.prompt_socket == server.agent_socket || server.agent_socket.front() != '/') return 2;
    if (g_mkdir_with_parents(folder.c_str(), 0700) != 0) return 1;
    struct stat info{};
    if (lstat(folder.c_str(), &info) != 0 || !S_ISDIR(info.st_mode) || info.st_uid != geteuid() || (info.st_mode & 0077)) return 1;
    Fd lock(open((folder + "/proxy.lock").c_str(), O_CREAT | O_CLOEXEC | O_RDWR | O_NOFOLLOW, 0600));
    if (lock.value < 0 || flock(lock.value, LOCK_EX | LOCK_NB) != 0) return 1;
    Fd agent(listen_socket(server.agent_socket)), prompt(listen_socket(server.prompt_socket));
    if (agent.value < 0 || prompt.value < 0) { std::cerr << "Koya SSH socket setup failed\n"; return 1; }
    signal(SIGTERM, [](int) { interrupted = 1; }); signal(SIGINT, [](int) { interrupted = 1; });
    struct Worker { std::thread thread; std::shared_ptr<std::atomic<bool>> done; };
    std::vector<Worker> workers;
    std::atomic<unsigned> active{0};
    std::string buffer;
    server.event("READY");
    while (!interrupted) {
        workers.erase(std::remove_if(workers.begin(), workers.end(), [](Worker &worker) {
            if (!*worker.done) return false;
            worker.thread.join(); return true;
        }), workers.end());
        pollfd ready[] = {{STDIN_FILENO, POLLIN | POLLHUP, 0}, {agent.value, POLLIN, 0}, {prompt.value, POLLIN, 0}};
        int count = poll(ready, 3, 200); if (count < 0) { if (errno == EINTR) continue; break; }
        if (ready[0].revents) {
            char chunk[4096]; ssize_t size = read(STDIN_FILENO, chunk, sizeof chunk);
            if (size <= 0) break;
            buffer.append(chunk, size); wipe(chunk, sizeof chunk);
            if (buffer.size() > 65536) break;
            size_t end;
            while ((end = buffer.find('\n')) != std::string::npos) {
                std::string line = buffer.substr(0, end); server.answer(line); wipe(line.data(), line.size());
                wipe(buffer.data(), end + 1); buffer.erase(0, end + 1);
            }
        }
        for (int index : {1,2}) if (ready[index].revents & POLLIN) {
            int fd = accept4(ready[index].fd, nullptr, nullptr, SOCK_CLOEXEC);
            if (fd < 0) continue;
            if (!same_user(fd) || active >= 32 || !server.track(fd)) { close(fd); continue; }
            ++active;
            auto done = std::make_shared<std::atomic<bool>>(false);
            workers.push_back({std::thread([&,fd,index,done] {
                Fd client(fd);
                if (index == 1) server.agent_client(fd); else server.prompt_client(fd);
                server.untrack(fd); --active; *done = true;
            }), done});
        }
    }
    wipe(buffer.data(), buffer.size()); server.stop();
    for (auto &worker : workers) worker.thread.join();
    unlink(server.agent_socket.c_str()); unlink(server.prompt_socket.c_str()); return 0;
}
