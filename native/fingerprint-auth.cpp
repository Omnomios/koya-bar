#include <security/pam_appl.h>
#include <pwd.h>
#include <unistd.h>
#include <sys/stat.h>
#include <cstdio>
#include <cstdlib>

// A separate, unprivileged PAM transaction: cancellation kills this process
// and closes its fprintd connection. Never accept a password in this helper.
static int conversation(int count, const pam_message **messages, pam_response **responses, void *) {
    if (count < 1 || count > PAM_MAX_NUM_MSG) return PAM_CONV_ERR;
    for (int i = 0; i < count; ++i)
        if (messages[i]->msg_style != PAM_TEXT_INFO && messages[i]->msg_style != PAM_ERROR_MSG) return PAM_CONV_ERR;
    // Only informational PAM messages reach the lock UI; never request secrets.
    for (int i = 0; i < count; ++i) {
        const unsigned char *text = reinterpret_cast<const unsigned char *>(messages[i]->msg);
        if (!text) continue;
        for (int j = 0; text[j] && j < 2048; ++j)
            putchar(text[j] < 32 || text[j] == 127 ? ' ' : text[j]);
        putchar('\n');
    }
    fflush(stdout);
    *responses = static_cast<pam_response *>(calloc(count, sizeof(pam_response)));
    return *responses ? PAM_SUCCESS : PAM_BUF_ERR;
}

int main() {
    // Missing service files must not fall through to the system's "other" policy.
    struct stat policy{};
    if (lstat("/etc/pam.d/koya-fingerprint", &policy) || !S_ISREG(policy.st_mode) || policy.st_uid != 0 || (policy.st_mode & 0022)) return 2;
    const passwd *account = getpwuid(getuid());
    if (!account || !account->pw_name || !*account->pw_name) return 2;
    pam_conv conv{conversation, nullptr};
    pam_handle_t *pam = nullptr;
    int result = pam_start("koya-fingerprint", account->pw_name, &conv, &pam);
    if (result == PAM_SUCCESS) result = pam_authenticate(pam, PAM_DISALLOW_NULL_AUTHTOK);
    const bool authenticated = result == PAM_SUCCESS;
    if (authenticated) result = pam_acct_mgmt(pam, 0);
    const bool accepted = result == PAM_SUCCESS;
    if (pam) pam_end(pam, result);
    return accepted ? 0 : authenticated ? 3 : result == PAM_MAXTRIES ? 4 : result == PAM_AUTHINFO_UNAVAIL ? 5 : 1;
}
