from pymavlink import mavutil

m = mavutil.mavlink_connection("tcp:127.0.0.1:5760")
m.wait_heartbeat()
print("connected", m.target_system, m.target_component)

m.mav.request_data_stream_send(
    m.target_system, m.target_component,
    mavutil.mavlink.MAV_DATA_STREAM_ALL, 4, 1,
)

for _ in range(40):
    p = m.recv_match(type="GLOBAL_POSITION_INT", blocking=True, timeout=10)
    if p:
        print(p.lat / 1e7, p.lon / 1e7, p.relative_alt / 1000, p.hdg / 100)
