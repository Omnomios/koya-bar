// Test-only PAM ABI interposition. The installed hx-pam plugin and its embedded
// helper run unchanged; no host PAM configuration or fingerprint reader is used.
#include <security/pam_appl.h>
#include <chrono>
#include <cstdlib>
#include <cstring>
#include <string>
#include <thread>
struct pam_handle { std::string service, user; pam_conv conversation; };
extern "C" int pam_start(const char* service, const char* user, const pam_conv* conversation, pam_handle_t** result) {
    if (!service || !user || std::strcmp(user, "koya-fixture") ||
        (std::strcmp(service, "koya-fingerprint") && std::strcmp(service, "koya-password-fixture"))) return PAM_SERVICE_ERR;
    *result = new pam_handle{service, user, *conversation}; return PAM_SUCCESS;
}
static int converse(pam_handle_t* handle, int type, const char* message, std::string* answer = nullptr) {
    pam_message prompt{type, message}; const pam_message* prompts[] = {&prompt}; pam_response* replies = nullptr;
    int result = handle->conversation.conv(1, prompts, &replies, handle->conversation.appdata_ptr);
    if (result != PAM_SUCCESS) return result;
    if (replies) {
        if (answer && replies[0].resp) *answer = replies[0].resp;
        if (replies[0].resp) { volatile char* p = replies[0].resp; for (size_t i = 0, n = std::strlen(replies[0].resp); i < n; i++) p[i] = 0; std::free(replies[0].resp); }
        std::free(replies);
    }
    return result;
}
extern "C" int pam_authenticate(pam_handle_t* handle, int flags) {
    if (!(flags & PAM_DISALLOW_NULL_AUTHTOK)) return PAM_SYSTEM_ERR;
    if (handle->service == "koya-password-fixture") {
        std::string answer; int result = converse(handle, PAM_PROMPT_ECHO_OFF, "Password: ", &answer);
        return result == PAM_SUCCESS && answer == "fixture-password" ? PAM_SUCCESS : PAM_AUTH_ERR;
    }
    const char* setting = std::getenv("KOYA_PAM_FIXTURE"); const std::string mode = setting ? setting : "denied";
    if (mode == "prompt") return converse(handle, PAM_PROMPT_ECHO_OFF, "Password must not be supplied: ");
    if (mode == "cancel" || mode == "timeout") { converse(handle, PAM_TEXT_INFO, "Waiting for finger"); std::this_thread::sleep_for(std::chrono::seconds(30)); }
    if (mode == "retry") {
        converse(handle, PAM_ERROR_MSG, "Failed to match fingerprint");
        converse(handle, PAM_TEXT_INFO, "Touch the sensor again");
    }
    if (mode == "denied") return PAM_AUTH_ERR;
    if (mode == "attempts") return PAM_MAXTRIES;
    if (mode == "unavailable") return PAM_AUTHINFO_UNAVAIL;
    return PAM_SUCCESS;
}
extern "C" int pam_acct_mgmt(pam_handle_t* handle, int) {
    const char* mode = std::getenv("KOYA_PAM_FIXTURE");
    return handle->service == "koya-fingerprint" && mode && std::strcmp(mode, "account") == 0 ? PAM_ACCT_EXPIRED : PAM_SUCCESS;
}
extern "C" int pam_end(pam_handle_t* handle, int) { delete handle; return PAM_SUCCESS; }
extern "C" const char* pam_strerror(pam_handle_t*, int code) {
    switch (code) { case PAM_SUCCESS: return "Success"; case PAM_MAXTRIES: return "Maximum attempts";
    case PAM_ACCT_EXPIRED: return "Account expired"; case PAM_CONV_ERR: return "Unexpected password prompt";
    case PAM_AUTH_ERR: return "Authentication denied"; default: return "PAM fixture failure"; }
}

#ifdef KOYA_PAM_IPC_PROBE
#include <cerrno>
#include <cstdio>
#include <sys/socket.h>
#include <unistd.h>
int main() {
    int pair[2];
    auto fail = [] {
        if (errno == EPERM || errno == EACCES) { std::puts("SKIP: sandbox does not permit the PAM plugin's private socket IPC"); return 77; }
        std::perror("PAM IPC probe"); return 1;
    };
    if (socketpair(AF_UNIX, SOCK_SEQPACKET | SOCK_CLOEXEC, 0, pair) < 0) return fail();
    const char packet[] = "fixture"; char reply[sizeof(packet)];
    if (send(pair[0], packet, sizeof(packet), MSG_NOSIGNAL) != sizeof(packet)) { int result = fail(); close(pair[0]); close(pair[1]); return result; }
    if (recv(pair[1], reply, sizeof(reply), 0) != sizeof(reply)) { int result = fail(); close(pair[0]); close(pair[1]); return result; }
    close(pair[0]); close(pair[1]); return std::memcmp(packet, reply, sizeof(packet)) ? 1 : 0;
}
#endif
