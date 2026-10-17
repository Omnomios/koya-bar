shared_library('hx-desktop', 'desktop.cpp', name_prefix: 'lib',
  override_options: ['b_lundef=false'], include_directories: include_directories('../sdk'),
  dependencies: [gio, dependency('threads'), meson.get_compiler('cpp').find_library('dl')],
  cpp_args: ['-fvisibility=hidden'])

shared_library('hx-login', 'login.cpp', name_prefix: 'lib',
  override_options: ['b_lundef=false'], include_directories: include_directories('../sdk'),
  dependencies: [gio], cpp_args: ['-fvisibility=hidden'])

ssh_agent = executable('koya-ssh-agent', 'ssh-agent.cpp', dependencies: [gio, dependency('threads')])

node_tests = find_program('node', required: false)
if node_tests.found() and find_program('ssh-agent', required: false).found() and find_program('ssh-keygen', required: false).found()
  test('ssh-agent-proxy', node_tests, args: [files('../../tests/ssh-agent.mjs'), ssh_agent.full_path()], timeout: 60)
endif
