shared_library('hx-desktop', 'desktop.cpp', name_prefix: 'lib',
  override_options: ['b_lundef=false'], include_directories: include_directories('../sdk'),
  dependencies: [gio, dependency('threads'), meson.get_compiler('cpp').find_library('dl')],
  cpp_args: ['-fvisibility=hidden'])

shared_library('hx-login', 'login.cpp', name_prefix: 'lib',
  override_options: ['b_lundef=false'], include_directories: include_directories('../sdk'),
  dependencies: [gio], cpp_args: ['-fvisibility=hidden'])

shared_library('hx-sleep', 'sleep.cpp', name_prefix: 'lib',
  override_options: ['b_lundef=false'], include_directories: include_directories('../sdk'),
  dependencies: [gio, dependency('threads')], cpp_args: ['-fvisibility=hidden'])

shared_library('hx-fingerprint', 'fingerprint.cpp', name_prefix: 'lib',
  override_options: ['b_lundef=false'], include_directories: include_directories('../sdk'),
  dependencies: [gio, dependency('threads'), meson.get_compiler('cpp').find_library('dl')],
  cpp_args: ['-fvisibility=hidden'])
executable('koya-fingerprint-auth', '../fingerprint-auth.cpp', dependencies: dependency('pam'))

ssh_agent = executable('koya-ssh-agent', 'ssh-agent.cpp', dependencies: [gio, dependency('threads')])
executable('koya-askpass', '../askpass.cpp', dependencies: [gio])
shared_library('hx-polkit-agent', 'polkit-agent.cpp', name_prefix: 'lib',
  override_options: ['b_lundef=false'], include_directories: include_directories('../sdk'),
  dependencies: [gio, dependency('polkit-agent-1'), meson.get_compiler('cpp').find_library('dl')],
  cpp_args: ['-fvisibility=hidden'])

node_tests = find_program('node', required: false)
if node_tests.found() and find_program('ssh-agent', required: false).found() and find_program('ssh-keygen', required: false).found()
  test('ssh-agent-proxy', node_tests, args: [files('../../tests/ssh-agent.mjs'), ssh_agent.full_path()], timeout: 60)
endif
