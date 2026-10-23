"""Private login1 fixture returning real UNIX descriptors over D-Bus."""
import json
import os
from gi.repository import Gio, GLib

assert os.environ['DBUS_SYSTEM_BUS_ADDRESS'] == 'unix:path=' + os.environ['XDG_RUNTIME_DIR'] + '/bus'
bus = Gio.bus_get_sync(Gio.BusType.SYSTEM, None)
path = '/org/freedesktop/login1'
inhibitors, pending, seen = {}, [], []
reject = hold = False
xml = '''<node><interface name="org.freedesktop.login1.Manager">
<method name="Inhibit"><arg type="s" direction="in"/><arg type="s" direction="in"/>
<arg type="s" direction="in"/><arg type="s" direction="in"/><arg type="h" direction="out"/></method>
</interface><interface name="org.koya.Test.Caffeine">
<method name="Count"><arg type="u" direction="out"/></method>
<method name="Seen"><arg type="s" direction="out"/></method>
<method name="Reject"><arg type="b" direction="in"/></method>
<method name="Hold"><arg type="b" direction="in"/></method>
<method name="Pending"><arg type="u" direction="out"/></method>
</interface></node>'''


def grant(invocation, values):
    read, write = os.pipe2(os.O_CLOEXEC | os.O_NONBLOCK)
    inhibitors[read] = values

    def released(fd, _condition):
        inhibitors.pop(fd, None)
        os.close(fd)
        return GLib.SOURCE_REMOVE

    GLib.io_add_watch(read, GLib.IO_HUP, released)
    fds = Gio.UnixFDList.new()
    index = fds.append(write)
    os.close(write)
    invocation.return_value_with_unix_fd_list(GLib.Variant('(h)', (index,)), fds)


def method(_connection, _sender, _path, _interface, name, parameters, invocation):
    global reject, hold
    values = parameters.unpack()
    if name == 'Count':
        return invocation.return_value(GLib.Variant('(u)', (len(inhibitors),)))
    if name == 'Seen':
        return invocation.return_value(GLib.Variant('(s)', (json.dumps(seen),)))
    if name == 'Pending':
        return invocation.return_value(GLib.Variant('(u)', (len(pending),)))
    if name == 'Inhibit':
        seen.append(values)
        if reject:
            return invocation.return_dbus_error('org.freedesktop.DBus.Error.AccessDenied', 'Fixture denies inhibition')
        if hold:
            pending.append((invocation, values))
        else:
            grant(invocation, values)
        return
    if name == 'Reject':
        reject = values[0]
    elif name == 'Hold':
        hold = values[0]
        if not hold:
            for request, args in pending:
                grant(request, args)
            pending.clear()
    else:
        return invocation.return_dbus_error('org.freedesktop.DBus.Error.UnknownMethod', name)
    invocation.return_value(None)


for interface in Gio.DBusNodeInfo.new_for_xml(xml).interfaces:
    bus.register_object(path, interface, method, None, None)
bus.call_sync('org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus', 'RequestName',
              GLib.Variant('(su)', ('org.freedesktop.login1', 4)), None, Gio.DBusCallFlags.NONE, 2000, None)
GLib.MainLoop().run()
