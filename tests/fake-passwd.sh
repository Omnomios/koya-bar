#!/usr/bin/env bash
# Stands in for passwd in tests: the current password is "old-secret"; a new
# password shorter than 8 characters is refused the way pam_pwquality does.
printf 'Changing password for fixture.\n'
printf 'Current password: '; IFS= read -rs current; printf '\n'
if [[ $current != old-secret ]]; then printf 'passwd: Authentication token manipulation error\npasswd: password unchanged\n'; exit 10; fi
printf 'New password: '; IFS= read -rs next; printf '\n'
if (( ${#next} < 8 )); then printf 'BAD PASSWORD: The password is shorter than 8 characters\nNew password: '; IFS= read -rs next; exit 10; fi
printf 'Retype new password: '; IFS= read -rs again; printf '\n'
[[ $next == "$again" ]] || { printf 'Sorry, passwords do not match.\n'; exit 10; }
printf 'passwd: password updated successfully\n'
