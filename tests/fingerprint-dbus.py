"""Private fprintd fixture; never connects to the machine's real reader."""
import os
from gi.repository import Gio, GLib
assert os.environ['DBUS_SYSTEM_BUS_ADDRESS'] == 'unix:path=' + os.environ['XDG_RUNTIME_DIR'] + '/bus'
bus = Gio.bus_get_sync(Gio.BusType.SYSTEM, None)
name, path = 'net.reactivated.Fprint', '/net/reactivated/Fprint/Device/0'
iface = name + '.Device'
prints, claimed, active = [], '', False
xml = '''<node><interface name="net.reactivated.Fprint.Manager">
<method name="GetDefaultDevice"><arg type="o" direction="out"/></method></interface>
<interface name="net.reactivated.Fprint.Device">
<method name="Claim"><arg type="s" direction="in"/></method><method name="Release"/>
<method name="ListEnrolledFingers"><arg type="s" direction="in"/><arg type="as" direction="out"/></method>
<method name="EnrollStart"><arg type="s" direction="in"/></method><method name="EnrollStop"/>
<method name="DeleteEnrolledFinger"><arg type="s" direction="in"/></method>
<property name="name" type="s" access="read"/><property name="num-enroll-stages" type="i" access="read"/>
<signal name="EnrollStatus"><arg type="s"/><arg type="b"/></signal>
</interface></node>'''

def method(_bus, sender, _path, _iface, member, parameters, invocation):
    global claimed, active, prints
    values = parameters.unpack()
    if member == 'GetDefaultDevice': return invocation.return_value(GLib.Variant('(o)', (path,)))
    if member == 'ListEnrolledFingers':
        assert values == ('',)
        return invocation.return_value(GLib.Variant('(as)', (prints,)))
    if member == 'Claim':
        assert values == ('',)
        if claimed: return invocation.return_dbus_error(name + '.Error.AlreadyInUse', 'Already claimed')
        claimed = sender
    elif sender != claimed:
        return invocation.return_dbus_error(name + '.Error.PermissionDenied', 'Not claimed')
    elif member == 'Release': claimed = ''
    elif member == 'EnrollStop': active = False
    elif member == 'DeleteEnrolledFinger': prints = [finger for finger in prints if finger != values[0]]
    elif member == 'EnrollStart':
        active = True
        finger = values[0]
        def complete():
            if active:
                prints.append(finger)
                bus.emit_signal(None, path, iface, 'EnrollStatus', GLib.Variant('(sb)', ('enroll-completed', True)))
            return GLib.SOURCE_REMOVE
        GLib.timeout_add(100, complete)
    invocation.return_value(None)

def property_value(_bus, _sender, _path, _iface, prop):
    return GLib.Variant('s', 'Fixture reader') if prop == 'name' else GLib.Variant('i', 3)

interfaces = Gio.DBusNodeInfo.new_for_xml(xml).interfaces
bus.register_object('/net/reactivated/Fprint/Manager', interfaces[0], method, None, None)
bus.register_object(path, interfaces[1], method, property_value, None)
bus.call_sync('org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus', 'RequestName',
              GLib.Variant('(su)', (name, 4)), None, Gio.DBusCallFlags.NONE, 2000, None)
print('READY', flush=True)
GLib.MainLoop().run()
