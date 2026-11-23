// Koya's greetd method selector. greetd remains the PAM transaction owner.
#include <security/pam_modules.h>
#include <security/pam_appl.h>
#include <cstdio>
#include <cctype>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>
#include <sys/stat.h>

#ifndef KOYA_GREETD_POLICY
#define KOYA_GREETD_POLICY "/etc/pam.d/greetd"
#endif
#ifndef KOYA_PAM_DIR
#define KOYA_PAM_DIR "/etc/pam.d/"
#endif
#ifndef KOYA_PAM_VENDOR_DIR
#define KOYA_PAM_VENDOR_DIR "/usr/lib/pam.d/"
#endif

static constexpr const char *prompt = "Koya authentication method v1:";

// Fingerprint bypasses the stock auth include, so allow it only while the
// stock guard chain has exactly the reviewed shape. Passwords use that chain.
static bool rules_match(const char *path, const std::vector<std::string> &expected, bool all_groups = false) {
    FILE *file = std::fopen(path, "r");
    if (!file) return false;
    std::vector<std::string> rules;
    char *line = nullptr; size_t size = 0;
    while (getline(&line, &size, file) >= 0) {
        std::string text(line);
        const auto comment = text.find('#');
        if (comment != std::string::npos) text.erase(comment);
        std::vector<std::string> words;
        for (size_t pos = 0; pos < text.size();) {
            pos = text.find_first_not_of(" \t\r\n", pos);
            if (pos == std::string::npos) break;
            const auto end = text.find_first_of(" \t\r\n", pos);
            words.push_back(text.substr(pos, end == std::string::npos ? end : end - pos));
            if (end == std::string::npos) break;
            pos = end;
        }
        if (words.empty()) continue;
        std::string type = words[0];
        for (char &c : type) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
        if (type == "@include") { std::free(line); std::fclose(file); return false; }
        if (type != "auth" && type != "-auth" &&
            !(all_groups && (type == "account" || type == "password" || type == "session"))) {
            if (all_groups) { std::free(line); std::fclose(file); return false; }
            continue;
        }
        words[0] = type;
        std::string normalized;
        for (const auto &word : words) { if (!normalized.empty()) normalized += ' '; normalized += word; }
        rules.push_back(normalized);
    }
    std::free(line); std::fclose(file);
    return rules == expected;
}
static bool stock_arch_auth() {
    return rules_match(KOYA_GREETD_POLICY, {"auth required pam_securetty.so", "auth requisite pam_nologin.so", "auth include system-local-login"})
        && rules_match(KOYA_PAM_DIR "system-local-login", {"auth include system-login"})
        && rules_match(KOYA_PAM_DIR "system-login", {"auth required pam_shells.so", "auth requisite pam_nologin.so", "auth include system-auth"})
        && rules_match(KOYA_PAM_DIR "system-auth", {
            "auth required pam_faillock.so preauth",
            "-auth [success=2 default=ignore] pam_systemd_home.so",
            "auth [success=1 default=bad] pam_unix.so try_first_pass nullok",
            "auth [default=die] pam_faillock.so authfail",
            "auth optional pam_permit.so",
            "auth required pam_env.so",
            "auth required pam_faillock.so authsucc"});
}
static bool stock_alpine_auth() {
    const auto effective = [](const char *name) {
        const std::string local = std::string(KOYA_PAM_DIR) + name;
        struct stat info {};
        return lstat(local.c_str(), &info) == 0 ? local : std::string(KOYA_PAM_VENDOR_DIR) + name;
    };
    // /etc/pam.d takes precedence even when its contents are not approved.
    return rules_match(effective("greetd").c_str(), {"auth include base-auth",
            "account include base-account", "password include base-password", "session include base-session"}, true)
        && rules_match(effective("base-auth").c_str(), {"auth required pam_unix.so nullok", "auth required pam_nologin.so",
            "auth required pam_env.so", "-auth optional pam_gnome_keyring.so",
            "-auth optional pam_kwallet5.so"});
}

extern "C" int pam_sm_authenticate(pam_handle_t *pamh, int, int argc, const char **argv) {
    if (argc > 1 || (argc == 1 && std::strcmp(argv[0], "platform=alpine"))) return PAM_AUTH_ERR;
    const pam_conv *conv = nullptr;
    if (pam_get_item(pamh, PAM_CONV, reinterpret_cast<const void **>(&conv)) != PAM_SUCCESS || !conv || !conv->conv)
        return PAM_AUTH_ERR;
    const pam_message question{PAM_PROMPT_ECHO_OFF, prompt};
    const pam_message *messages[] = {&question};
    pam_response *response = nullptr;
    const int status = conv->conv(1, messages, &response, conv->appdata_ptr);
    if (status != PAM_SUCCESS || !response || !response->resp) { std::free(response); return PAM_AUTH_ERR; }
    const bool fingerprint = std::strcmp(response->resp, "fingerprint") == 0;
    int result = PAM_AUTH_ERR;
    if (fingerprint) result = (argc == 1 ? stock_alpine_auth() : stock_arch_auth()) ? PAM_AUTHINFO_UNAVAIL : PAM_AUTH_ERR;
    else if (std::strcmp(response->resp, "password") == 0) result = PAM_SUCCESS;
    volatile char *secret = response->resp;
    for (size_t i = 0, n = std::strlen(response->resp); i < n; ++i) secret[i] = 0;
    std::free(response->resp); std::free(response);
    return result;
}

extern "C" int pam_sm_setcred(pam_handle_t *, int, int, const char **) { return PAM_SUCCESS; }
