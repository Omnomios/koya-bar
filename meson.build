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
bash = find_program('bash')
koya = find_program('koya', required: false)
if koya.found()
  test('models', bash, args: files('tests/models.sh'), timeout: 60)
  test('fingerprint-native', bash, args: files('tests/fingerprint-native.sh'), timeout: 40)
endif
python = find_program('python3', required: false)
if python.found()
  test('fingerprint-install', python, args: files('tests/fingerprint-install.py'))
endif
