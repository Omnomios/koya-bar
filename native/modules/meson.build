shared_library('hx-desktop', 'desktop.cpp', name_prefix: 'lib',
  override_options: ['b_lundef=false'], include_directories: include_directories('../sdk'),
  dependencies: [gio, dependency('threads'), meson.get_compiler('cpp').find_library('dl')],
  cpp_args: ['-fvisibility=hidden'])

ssh_agent = executable('koya-ssh-agent', 'ssh-agent.cpp', dependencies: [gio, dependency('threads')])

python = find_program('python3', required: false)
if python.found() and find_program('ssh-agent', required: false).found() and find_program('ssh-keygen', required: false).found()
  test('ssh-agent-proxy', python, args: [files('../../tests/ssh-agent.py'), ssh_agent.full_path()], timeout: 60)
endif
