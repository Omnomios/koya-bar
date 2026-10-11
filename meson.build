project('koya-bar', 'cpp', version: '0.2.0',
  default_options: ['cpp_std=c++17', 'warning_level=2'])
gio = dependency('gio-unix-2.0')
subdir('native/modules')
desktop_config = configuration_data()
desktop_config.set('SHELL_ROOT', meson.project_source_root())
foreach app : ['settings', 'wifi']
  configure_file(input: 'applications/koya-' + app + '.desktop.in',
    output: 'koya-' + app + '.desktop', configuration: desktop_config)
endforeach
configure_file(input: 'hypridle.example.conf.in', output: 'hypridle.example.conf', configuration: desktop_config)
node = find_program('node', required: false)
if node.found()
  test('desktop-models', node, args: files('tests/models.mjs'))
  test('ssh-prompt-model', node, args: files('tests/ssh-agent-model.mjs'))
  test('surface-cursors', node, args: ['--experimental-vm-modules', files('tests/cursor.mjs')])
  test('ui-batching', node, args: ['--experimental-vm-modules', files('tests/batching.mjs')])
endif
