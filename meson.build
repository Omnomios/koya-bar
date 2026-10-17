project('koya-bar', 'cpp', version: '0.2.0', license: 'CC-BY-4.0',
  default_options: ['cpp_std=c++17', 'warning_level=2'])
gio = dependency('gio-unix-2.0')
subdir('native/modules')
desktop_config = configuration_data()
desktop_config.set('SHELL_ROOT', meson.project_source_root())
foreach app : ['settings', 'wifi', 'account']
  configure_file(input: 'applications/koya-' + app + '.desktop.in',
    output: 'koya-' + app + '.desktop', configuration: desktop_config)
endforeach
configure_file(input: 'hypridle.example.conf.in', output: 'hypridle.example.conf', configuration: desktop_config)
node = find_program('node', required: false)
if node.found()
  foreach suite : ['login', 'lock', 'accounts', 'ssh-agent-model']
    test(suite, node, args: files('tests/' + suite + '.mjs'))
  endforeach
endif
