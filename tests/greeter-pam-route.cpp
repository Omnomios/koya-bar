#include <security/pam_appl.h>
#include <cassert>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
static int converse(int count, const pam_message **messages, pam_response **out, void *) {
    assert(count == 1);
    *out = static_cast<pam_response *>(std::calloc(1, sizeof(pam_response)));
    if (messages[0]->msg_style == PAM_PROMPT_ECHO_OFF) {
        const char *answer = std::strcmp(messages[0]->msg, "Koya authentication method v1:") == 0
            ? std::getenv("KOYA_METHOD") : std::getenv("KOYA_PASSWORD");
        (*out)->resp = ::strdup(answer ? answer : "");
    }
    return PAM_SUCCESS;
}
static int calls(const char *log, const char *name) {
    FILE *file = std::fopen(log, "r"); assert(file);
    int total = 0; char line[128];
    while (std::fgets(line, sizeof line, file)) if (std::strncmp(line, name, std::strlen(name)) == 0) ++total;
    std::fclose(file); return total;
}
static void attempt(const char *dir, const char *log, const char *method, const char *password,
                    const char *scan, const char *account, int expected, int scans) {
    setenv("KOYA_METHOD", method, 1); setenv("KOYA_PASSWORD", password, 1);
    setenv("KOYA_SCAN", scan, 1); setenv("KOYA_ACCOUNT", account, 1);
    FILE *file = std::fopen(log, "w"); assert(file); std::fclose(file);
    pam_conv conversation{converse, nullptr}; pam_handle_t *handle = nullptr;
    assert(pam_start_confdir("koya-greeter", "fixture", &conversation, dir, &handle) == PAM_SUCCESS);
    int result = pam_authenticate(handle, 0);
    if (result != expected) { std::fprintf(stderr, "method=%s auth=%d expected=%d\n", method, result, expected); FILE *trace = std::fopen(log, "r"); char line[128]; while (std::fgets(line, sizeof line, trace)) std::fputs(line, stderr); std::fclose(trace); std::abort(); }
    if (calls(log, "fingerprint") != scans) {
        std::fprintf(stderr, "method=%s expected scans=%d actual=%d\n", method, scans, calls(log, "fingerprint"));
        FILE *trace = std::fopen(log, "r"); char line[128]; while (std::fgets(line, sizeof line, trace)) std::fputs(line, stderr); std::fclose(trace);
        std::abort();
    }
    if (!std::strcmp(method, "password")) assert(calls(log, "unix") == 1);
    if (!std::strcmp(method, "fingerprint")) assert(calls(log, "unix") == 0);
    if (expected == PAM_SUCCESS) {
        assert(pam_acct_mgmt(handle, 0) == (std::strcmp(account, "deny") ? PAM_SUCCESS : PAM_PERM_DENIED));
        if (std::strcmp(account, "deny")) {
            assert(pam_setcred(handle, PAM_ESTABLISH_CRED) == PAM_SUCCESS);
            assert(pam_open_session(handle, 0) == PAM_SUCCESS);
            assert(calls(log, "setcred") > 0 && calls(log, "session") > 0);
            assert(pam_close_session(handle, 0) == PAM_SUCCESS);
        }
    }
    pam_end(handle, PAM_SUCCESS);
}
int main(int argc, char **argv) {
    assert(argc == 3);
    attempt(argv[1], argv[2], "password", "correct", "success", "allow", PAM_SUCCESS, 0);
    attempt(argv[1], argv[2], "password", "wrong", "success", "allow", PAM_AUTH_ERR, 0);
    attempt(argv[1], argv[2], "fingerprint", "", "success", "allow", PAM_SUCCESS, 1);
    attempt(argv[1], argv[2], "fingerprint", "", "ignore", "allow", PAM_PERM_DENIED, 1);
    attempt(argv[1], argv[2], "fingerprint", "", "success", "deny", PAM_SUCCESS, 1);
    attempt(argv[1], argv[2], "KOYA_GREETER_FINGERPRINT_V1:4dce7a6f-16d6-4299-b7e2-975addde31b8", "", "success", "allow", PAM_AUTH_ERR, 0);
    const std::string approved = std::string(argv[1]) + "/../approved/system-login";
    FILE *file = std::fopen(approved.c_str(), "a"); assert(file);
    std::fputs("-AUTH requisite pam_deny.so\n", file); std::fclose(file);
    attempt(argv[1], argv[2], "fingerprint", "", "success", "allow", PAM_AUTH_ERR, 0);
    attempt(argv[1], argv[2], "password", "correct", "success", "allow", PAM_SUCCESS, 0);
    std::puts("Koya Linux-PAM route: passed");
}
