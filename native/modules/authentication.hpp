#pragma once
#define POLKIT_AGENT_I_KNOW_API_IS_SUBJECT_TO_CHANGE
#include <polkitagent/polkitagent.h>
#include <pwd.h>
#include <unistd.h>
#include <climits>
#include <fstream>
#include <iterator>
#include <algorithm>
#include <cstring>
#include <deque>
#include <memory>
#include <string>
#include <utility>
#include <functional>

class AuthenticationAgent;
typedef struct {
    PolkitAgentListener parent;
    AuthenticationAgent *agent;
} KoyaAuthenticationListener;
typedef struct { PolkitAgentListenerClass parent; } KoyaAuthenticationListenerClass;
G_DEFINE_TYPE(KoyaAuthenticationListener, koya_authentication_listener, POLKIT_AGENT_TYPE_LISTENER)

// Polkit owns the authority and PAM exchange. Koya only renders each prompt
// and returns its response; neither the cookie nor passwords are logged.
class AuthenticationAgent {
    struct Request {
        AuthenticationAgent *owner;
        guint id;
        GTask *task = nullptr;
        GCancellable *cancellable = nullptr;
        std::function<void(bool, const char *)> answer;
        gulong cancel_handler = 0;
        PolkitAgentSession *session = nullptr;
        std::string action, message, cookie, user, question, sender, requester;
        PolkitIdentity *identity = nullptr;
        bool started = false;
        bool waiting = false;
        bool cancelling = false;
        int attempts = 0;
    };
    // Matches sudo's default passwd_tries.
    static constexpr int MAX_ATTEMPTS = 3;
    GDBusConnection *bus;
    GMainContext *context = g_main_context_ref_thread_default();
    KoyaAuthenticationListener *listener;
    gpointer registration = nullptr;
    std::deque<std::unique_ptr<Request>> requests;
    std::shared_ptr<bool> lifetime = std::make_shared<bool>(true);
    guint next_id = 0;
    guint sender_watch = 0;
    bool stopping = false;
    std::function<void(const char *, GVariant *)> notify;

    void signal(const char *name, GVariant *arguments) {
        g_variant_ref_sink(arguments);
        notify(name, arguments);
        g_variant_unref(arguments);
    }
    Request *find(guint id) {
        for (auto &request : requests) if (request->id == id) return request.get();
        return nullptr;
    }
    void finish(guint id, bool cancelled = false, const char *answer = nullptr) {
        auto it = std::find_if(requests.begin(), requests.end(), [id](auto &r) { return r->id == id; });
        if (it == requests.end()) return;
        auto request = std::move(*it);
        requests.erase(it);
        if (request->cancel_handler) g_cancellable_disconnect(request->cancellable, request->cancel_handler);
        if (request->session) {
            g_signal_handlers_disconnect_by_data(request->session, request.get());
            g_object_unref(request->session);
        }
        signal("AuthenticationEnd", g_variant_new("(u)", id));
        if (request->answer) {
            request->answer(cancelled || !answer, answer);
        } else {
            if (cancelled) g_task_return_new_error(request->task, G_IO_ERROR, G_IO_ERROR_CANCELLED, "Authentication cancelled");
            else g_task_return_boolean(request->task, TRUE);
            g_object_unref(request->task);
            g_object_unref(request->identity);
        }
        if (!stopping && !requests.empty() && !requests.front()->started) begin();
    }
    void begin() {
        if (requests.empty()) return;
        auto *request = requests.front().get();
        if (request->started) return;
        request->started = true;
        if (request->answer) {
            request->waiting = true;
            signal("AuthenticationBegin", g_variant_new("(ussss)", request->id,
                request->action.c_str(), request->message.c_str(), request->user.c_str(), request->requester.c_str()));
            signal("AuthenticationPrompt", g_variant_new("(usb)", request->id, request->question.c_str(), FALSE));
            return;
        }
        signal("AuthenticationBegin", g_variant_new("(ussss)", request->id, request->action.c_str(), request->message.c_str(), request->user.c_str(), request->requester.c_str()));
        open_session(request);
    }
    // One PAM conversation. A refused password opens a fresh conversation for
    // the same request, so the prompt stays up; polkitd keeps the cookie valid
    // until the agent returns.
    void open_session(Request *request) {
        request->session = polkit_agent_session_new(request->identity, request->cookie.c_str());
        g_signal_connect(request->session, "request", G_CALLBACK(+[](PolkitAgentSession*, const char *question, gboolean echo, gpointer data) {
            auto *r = static_cast<Request*>(data);
            r->waiting = true;
            r->owner->signal("AuthenticationPrompt", g_variant_new("(usb)", r->id, question, echo));
        }), request);
        g_signal_connect(request->session, "show-info", G_CALLBACK(+[](PolkitAgentSession*, const char *message, gpointer data) {
            auto *r = static_cast<Request*>(data);
            r->owner->signal("AuthenticationMessage", g_variant_new("(usb)", r->id, message, FALSE));
        }), request);
        g_signal_connect(request->session, "show-error", G_CALLBACK(+[](PolkitAgentSession*, const char *message, gpointer data) {
            auto *r = static_cast<Request*>(data);
            r->owner->signal("AuthenticationMessage", g_variant_new("(usb)", r->id, message, TRUE));
        }), request);
        g_signal_connect(request->session, "completed", G_CALLBACK(+[](PolkitAgentSession*, gboolean gained, gpointer data) {
            auto *r = static_cast<Request*>(data);
            if (!gained && !r->cancelling && !r->owner->stopping && ++r->attempts < MAX_ATTEMPTS) r->owner->retry(r->id);
            else r->owner->finish(r->id, r->cancelling);
        }), request);
        auto *session = POLKIT_AGENT_SESSION(g_object_ref(request->session));
        polkit_agent_session_initiate(session);
        g_object_unref(session);
    }
    // Replace the refused conversation once its completion has been emitted.
    void retry(guint id) {
        auto *source = g_idle_source_new();
        g_source_set_callback(source, +[](gpointer data)->gboolean {
            auto *pending = static_cast<std::pair<std::weak_ptr<bool>, std::pair<AuthenticationAgent*, guint>>*>(data);
            if (pending->first.expired()) return G_SOURCE_REMOVE;
            auto *agent = pending->second.first;
            auto *r = agent->find(pending->second.second);
            if (!r || r->cancelling || agent->stopping || !r->session) return G_SOURCE_REMOVE;
            g_signal_handlers_disconnect_by_data(r->session, r);
            g_object_unref(r->session); r->session = nullptr;
            agent->signal("AuthenticationMessage", g_variant_new("(usb)", r->id, "Incorrect password", TRUE));
            agent->open_session(r);
            return G_SOURCE_REMOVE;
        }, new std::pair<std::weak_ptr<bool>, std::pair<AuthenticationAgent*, guint>>(lifetime, {this, id}), +[](gpointer data) {
            delete static_cast<std::pair<std::weak_ptr<bool>, std::pair<AuthenticationAgent*, guint>>*>(data);
        });
        g_source_attach(source, context);
        g_source_unref(source);
    }
    // Who is asking, for display only. When the caller is Koya's askpass, its
    // parent is the program that wants the secret (sudo, ssh); any other
    // caller is shown as itself, so a dialog can't borrow another's name.
    static std::string executable(guint32 pid) {
        char path[PATH_MAX];
        ssize_t length = readlink(("/proc/" + std::to_string(pid) + "/exe").c_str(), path, sizeof path - 1);
        return length > 0 ? std::string(path, length) : std::string();
    }
    static guint32 parent(guint32 pid) {
        std::ifstream file("/proc/" + std::to_string(pid) + "/stat");
        std::string stat((std::istreambuf_iterator<char>(file)), {});
        // The command name can hold spaces and parentheses; fields follow the last ')'.
        auto end = stat.rfind(')');
        unsigned long state = 0;
        char code;
        if (end == std::string::npos || sscanf(stat.c_str() + end + 1, " %c %lu", &code, &state) != 2) return 0;
        return static_cast<guint32>(state);
    }
    static std::string command(guint32 pid) {
        std::ifstream file("/proc/" + std::to_string(pid) + "/cmdline");
        std::string line((std::istreambuf_iterator<char>(file)), {});
        while (!line.empty() && line.back() == '\0') line.pop_back();
        std::replace(line.begin(), line.end(), '\0', ' ');
        if (line.empty()) {
            auto path = executable(pid);
            line = path.substr(path.rfind('/') + 1);
        }
        if (line.size() > 240) line = line.substr(0, 239) + "…";
        gchar *valid = g_utf8_make_valid(line.c_str(), -1);
        std::string result = valid; g_free(valid);
        return result;
    }
    std::string requester(const char *sender) {
        GVariant *reply = g_dbus_connection_call_sync(bus, "org.freedesktop.DBus", "/org/freedesktop/DBus", "org.freedesktop.DBus",
            "GetConnectionUnixProcessID", g_variant_new("(s)", sender), G_VARIANT_TYPE("(u)"), G_DBUS_CALL_FLAGS_NONE, 1000, nullptr, nullptr);
        if (!reply) return {};
        guint32 pid = 0;
        g_variant_get(reply, "(u)", &pid);
        g_variant_unref(reply);
        if (!askpass.empty() && executable(pid) == askpass) pid = parent(pid);
        return pid ? command(pid) : std::string();
    }
  public:
    // The askpass helper built alongside this module; its callers' parents are trusted to name the request.
    std::string askpass;
    explicit AuthenticationAgent(GDBusConnection *connection, std::function<void(const char *, GVariant *)> callback): bus(connection),
        listener(static_cast<KoyaAuthenticationListener*>(g_object_new(koya_authentication_listener_get_type(), nullptr))), notify(std::move(callback)) {
        listener->agent = this;
        sender_watch = g_dbus_connection_signal_subscribe(bus, "org.freedesktop.DBus", "org.freedesktop.DBus",
            "NameOwnerChanged", "/org/freedesktop/DBus", nullptr, G_DBUS_SIGNAL_FLAGS_NONE,
            +[](GDBusConnection*, const gchar*, const gchar*, const gchar*, const gchar*, GVariant *parameters, gpointer data) {
                const char *name, *before, *after;
                g_variant_get(parameters, "(&s&s&s)", &name, &before, &after);
                if (*after) return;
                auto *agent = static_cast<AuthenticationAgent*>(data);
                while (true) {
                    guint id = 0;
                    for (auto &request : agent->requests) {
                        if (request->sender == name) { id = request->id; break; }
                    }
                    if (!id) break;
                    agent->cancel(id);
                }
            }, this, nullptr);
    }
    ~AuthenticationAgent() {
        g_dbus_connection_signal_unsubscribe(bus, sender_watch);
        stop(); lifetime.reset(); g_object_unref(listener); g_main_context_unref(context);
    }
    bool start() {
        if (registration) return true;
        stopping = false;
#ifdef KOYA_TESTING
        return true;
#else
        GError *error = nullptr;
        PolkitSubject *subject = polkit_unix_session_new_for_process_sync(getpid(), nullptr, &error);
        if (subject) {
            registration = polkit_agent_listener_register(POLKIT_AGENT_LISTENER(listener),
                POLKIT_AGENT_REGISTER_FLAGS_NONE, subject, nullptr, nullptr, &error);
            g_object_unref(subject);
        }
        if (error) {
            g_warning("Koya authentication agent: %s", error->message);
            g_error_free(error);
        }
        return registration != nullptr;
#endif
    }
    void stop() {
        stopping = true;
        if (registration) { polkit_agent_listener_unregister(registration); registration = nullptr; }
        while (!requests.empty()) {
            guint id = requests.front()->id;
            if (requests.front()->session) {
                requests.front()->cancelling = true;
                auto *session = POLKIT_AGENT_SESSION(g_object_ref(requests.front()->session));
                polkit_agent_session_cancel(session);
                g_object_unref(session);
            }
            if (find(id)) finish(id, true);
        }
    }
    void enqueue(const char *action, const char *message, const char *cookie, GList *identities,
                 GCancellable *cancellable, GAsyncReadyCallback callback, gpointer data) {
        PolkitIdentity *identity = nullptr;
        for (GList *item = identities; item; item = item->next) {
            auto *candidate = POLKIT_IDENTITY(item->data);
            if (!POLKIT_IS_UNIX_USER(candidate)) continue;
            if (!identity) identity = candidate;
            if (polkit_unix_user_get_uid(POLKIT_UNIX_USER(candidate)) == static_cast<gint>(getuid())) {
                identity = candidate; break;
            }
        }
        GTask *task = g_task_new(listener, cancellable, callback, data);
        if (stopping) {
            g_task_return_new_error(task, G_IO_ERROR, G_IO_ERROR_CANCELLED, "Authentication agent stopped");
            g_object_unref(task); return;
        }
        if (!identity) {
            g_task_return_new_error(task, G_IO_ERROR, G_IO_ERROR_FAILED, "No authentication identity is available");
            g_object_unref(task); return;
        }
        auto request = std::make_unique<Request>();
        request->owner = this;
        request->id = ++next_id;
        request->task = task;
        request->cancellable = cancellable;
        request->action = action;
        request->message = message;
        request->cookie = cookie;
        request->identity = POLKIT_IDENTITY(g_object_ref(identity));
        if (POLKIT_IS_UNIX_USER(identity)) {
            auto *entry = getpwuid(polkit_unix_user_get_uid(POLKIT_UNIX_USER(identity)));
            if (entry) request->user = entry->pw_name;
        }
        if (request->user.empty()) {
            char *name = polkit_identity_to_string(identity);
            request->user = name ? name : "Administrator";
            g_free(name);
        }
        guint id = request->id;
        requests.push_back(std::move(request));
        if (cancellable) requests.back()->cancel_handler = g_cancellable_connect(cancellable,
            G_CALLBACK(+[](GCancellable*, gpointer data) {
                auto *r = static_cast<Request*>(data);
                auto *agent = r->owner;
                guint id = r->id;
                auto *source = g_idle_source_new();
                g_source_set_callback(source, +[](gpointer data)->gboolean {
                    auto *pending = static_cast<std::pair<std::weak_ptr<bool>, std::pair<AuthenticationAgent*, guint>>*>(data);
                    if (!pending->first.expired()) pending->second.first->cancel(pending->second.second);
                    return G_SOURCE_REMOVE;
                }, new std::pair<std::weak_ptr<bool>, std::pair<AuthenticationAgent*, guint>>(
                    agent->lifetime, {agent, id}), +[](gpointer data) {
                    delete static_cast<std::pair<std::weak_ptr<bool>, std::pair<AuthenticationAgent*, guint>>*>(data);
                });
                g_source_attach(source, agent->context);
                g_source_unref(source);
            }), requests.back().get(), nullptr);
        if (requests.front()->id == id) begin();
    }
    void ask(const char *question, const char *mode, const char *origin, std::function<void(bool, const char *)> answer) {
        if (stopping || !*question || strlen(question) > 2048 ||
            (strcmp(mode, "entry") && strcmp(mode, "confirm") && strcmp(mode, "none"))) {
            answer(true, nullptr);
            return;
        }
        auto request = std::make_unique<Request>();
        request->owner = this;
        request->id = ++next_id;
        request->answer = std::move(answer);
        request->sender = origin;
        request->requester = requester(origin);
        request->action = std::string("org.koya.Askpass.") + mode;
        request->message = "Authentication requested";
        request->question = question;
        auto *entry = getpwuid(getuid());
        request->user = entry ? entry->pw_name : "Current user";
        guint id = request->id;
        requests.push_back(std::move(request));
        if (requests.front()->id == id) begin();
    }
    void respond(guint id, const char *answer) {
        if (requests.empty() || requests.front()->id != id || !requests.front()->waiting) return;
        requests.front()->waiting = false;
        if (requests.front()->answer) { finish(id, false, answer); return; }
        if (!requests.front()->session) return;
        auto *session = POLKIT_AGENT_SESSION(g_object_ref(requests.front()->session));
        polkit_agent_session_response(session, answer);
        g_object_unref(session);
    }
    void cancel(guint id) {
        auto *request = find(id);
        if (!request) return;
        if (request->session) {
            request->cancelling = true;
            auto *session = POLKIT_AGENT_SESSION(g_object_ref(request->session));
            polkit_agent_session_cancel(session);
            g_object_unref(session);
        }
        if (find(id)) finish(id, true);
    }
};

static void koya_authentication_listener_init(KoyaAuthenticationListener *self) { self->agent = nullptr; }
static void koya_authentication_listener_class_init(KoyaAuthenticationListenerClass *klass) {
    auto *base = POLKIT_AGENT_LISTENER_CLASS(klass);
    base->initiate_authentication = +[](PolkitAgentListener *listener, const gchar *action, const gchar *message,
        const gchar*, PolkitDetails*, const gchar *cookie, GList *identities, GCancellable *cancellable,
        GAsyncReadyCallback callback, gpointer data) {
        auto *self = reinterpret_cast<KoyaAuthenticationListener*>(listener);
        self->agent->enqueue(action, message, cookie, identities, cancellable, callback, data);
    };
    base->initiate_authentication_finish = +[](PolkitAgentListener*, GAsyncResult *result, GError **error)->gboolean {
        return g_task_propagate_boolean(G_TASK(result), error);
    };
}
