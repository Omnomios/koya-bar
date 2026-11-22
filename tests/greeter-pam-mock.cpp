#include <security/pam_modules.h>
#include <security/pam_appl.h>
#include <cstdio>
#include <cstdlib>
#include <cstring>
static void log(const char *name) {
    FILE *file = std::fopen(std::getenv("KOYA_LOG"), "a"); if (!file) std::abort();
    std::fprintf(file, "%s\n", name); std::fclose(file);
}
extern "C" int pam_sm_authenticate(pam_handle_t *handle, int, int argc, const char **argv) {
    const char *role = argc ? argv[0] : "";
    log(role);
    if (!std::strcmp(role, "fingerprint")) {
        return !std::strcmp(std::getenv("KOYA_SCAN"), "ignore") ? PAM_IGNORE : PAM_SUCCESS;
    }
    if (!std::strcmp(role, "systemd_home")) return PAM_IGNORE;
    if (!std::strcmp(role, "securetty") || !std::strcmp(role, "nologin")) return PAM_IGNORE;
    if (!std::strcmp(role, "faillock") && argc > 1 && !std::strcmp(argv[1], "authfail")) return PAM_AUTH_ERR;
    if (!std::strcmp(role, "unix")) {
        const pam_conv *conv = nullptr;
        if (pam_get_item(handle, PAM_CONV, reinterpret_cast<const void **>(&conv)) != PAM_SUCCESS) return PAM_AUTH_ERR;
        pam_message question{PAM_PROMPT_ECHO_OFF, "Password:"};
        const pam_message *messages[] = {&question}; pam_response *response = nullptr;
        int result = conv->conv(1, messages, &response, conv->appdata_ptr);
        bool good = result == PAM_SUCCESS && response && response->resp && !std::strcmp(response->resp, "correct");
        if (response) { std::free(response->resp); std::free(response); }
        return good ? PAM_SUCCESS : PAM_AUTH_ERR;
    }
    return PAM_SUCCESS;
}
extern "C" int pam_sm_acct_mgmt(pam_handle_t *, int, int, const char **) {
    log("account"); return !std::strcmp(std::getenv("KOYA_ACCOUNT"), "deny") ? PAM_PERM_DENIED : PAM_SUCCESS;
}
extern "C" int pam_sm_setcred(pam_handle_t *, int, int, const char **) { log("setcred"); return PAM_SUCCESS; }
extern "C" int pam_sm_open_session(pam_handle_t *, int, int, const char **) { log("session"); return PAM_SUCCESS; }
extern "C" int pam_sm_close_session(pam_handle_t *, int, int, const char **) { return PAM_SUCCESS; }
