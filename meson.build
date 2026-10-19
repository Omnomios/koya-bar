project('koya-bar', 'cpp', version: run_command('cat', files('VERSION'), check: true).stdout().strip(), license: 'CC-BY-4.0',
  default_options: ['cpp_std=c++17', 'warning_level=2'])
gio = dependency('gio-unix-2.0')
subdir('native/modules')
desktop_config = configuration_data()
desktop_config.set('SHELL_ROOT', meson.project_source_root())
foreach app : ['settings', 'wifi', 'account', 'updates', 'displays']
  configure_file(input: 'applications/koya-' + app + '.desktop.in',
    output: 'koya-' + app + '.desktop', configuration: desktop_config)
endforeach
configure_file(input: 'hypridle.example.conf.in', output: 'hypridle.example.conf', configuration: desktop_config)
node = find_program('node', required: false)
if node.found()
  foreach suite : ['login', 'lock', 'accounts', 'ssh-agent-model', 'authentication', 'authentication-view', 'updates', 'audio', 'session-actions', 'displays']
    test(suite, node, args: files('tests/' + suite + '.mjs'))
  endforeach
endif
