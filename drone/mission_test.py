import math
import time

from pymavlink import mavutil

mav = mavutil.mavlink

GUIDED, AUTO = 4, 3
ALT_M = 30
WAYPOINTS = [(0, 20), (20, 20), (20, 0)]  # (동쪽 m, 북쪽 m)

m = mavutil.mavlink_connection("tcp:127.0.0.1:5760")
m.wait_heartbeat()
TS, TC = m.target_system, 1
m.mav.request_data_stream_send(TS, TC, mav.MAV_DATA_STREAM_ALL, 4, 1)


def command(cmd, *params):
    params = list(params) + [0] * (7 - len(params))
    m.mav.command_long_send(TS, TC, cmd, 0, *params)
    end = time.time() + 3
    while time.time() < end:
        msg = m.recv_match(type=["COMMAND_ACK", "STATUSTEXT"], blocking=True, timeout=1)
        if msg is None:
            continue
        if msg.get_type() == "STATUSTEXT":
            print("[fc]", msg.text)
        elif msg.command == cmd:
            return msg.result == mav.MAV_RESULT_ACCEPTED
    return False


def set_mode(mode):
    for _ in range(30):
        m.mav.set_mode_send(TS, mav.MAV_MODE_FLAG_CUSTOM_MODE_ENABLED, mode)
        hb = m.recv_match(type="HEARTBEAT", blocking=True, timeout=2)
        if hb and hb.custom_mode == mode:
            return
        time.sleep(1)
    raise SystemExit(f"mode {mode} failed")


# 1. GPS 대기
while True:
    p = m.recv_match(type="GLOBAL_POSITION_INT", blocking=True, timeout=10)
    if p and p.lat != 0:
        home_lat, home_lon = p.lat / 1e7, p.lon / 1e7
        break
print("home ready")


def offset(x_m, y_m):
    lat = home_lat + y_m / 111320
    lon = home_lon + x_m / (111320 * math.cos(math.radians(home_lat)))
    return lat, lon


# 2. 미션 업로드 (0번은 home 자리)
REL = mav.MAV_FRAME_GLOBAL_RELATIVE_ALT_INT
items = [(mav.MAV_FRAME_GLOBAL_INT, mav.MAV_CMD_NAV_WAYPOINT, 0, home_lat, home_lon, 0)]
for x_m, y_m in WAYPOINTS:
    lat, lon = offset(x_m, y_m)
    items.append((REL, mav.MAV_CMD_NAV_WAYPOINT, 2, lat, lon, ALT_M))
items.append((REL, mav.MAV_CMD_NAV_RETURN_TO_LAUNCH, 0, 0, 0, 0))

m.mav.mission_count_send(TS, TC, len(items))
while True:
    msg = m.recv_match(type=["MISSION_REQUEST_INT", "MISSION_REQUEST", "MISSION_ACK"], blocking=True, timeout=5)
    if msg is None:
        raise SystemExit("mission upload timeout")
    if msg.get_type() == "MISSION_ACK":
        if msg.type != mav.MAV_MISSION_ACCEPTED:
            raise SystemExit(f"mission rejected: {msg.type}")
        break
    frame, cmd, hold, lat, lon, alt = items[msg.seq]
    m.mav.mission_item_int_send(
        TS, TC, msg.seq, frame, cmd, 0, 1,
        hold, 0, 0, 0, int(lat * 1e7), int(lon * 1e7), alt,
    )
print("mission uploaded", len(items))

# 3. 시동과 이륙
set_mode(GUIDED)
end = time.time() + 90
while not command(mav.MAV_CMD_COMPONENT_ARM_DISARM, 1):
    if time.time() > end:
        raise SystemExit("arm failed")
    time.sleep(2)
print("armed")

if not command(mav.MAV_CMD_NAV_TAKEOFF, 0, 0, 0, 0, 0, 0, ALT_M):
    raise SystemExit("takeoff rejected")
while True:
    p = m.recv_match(type="GLOBAL_POSITION_INT", blocking=True, timeout=10)
    if p and p.relative_alt / 1000 >= ALT_M * 0.95:
        break
print("takeoff done")

# 4. 미션 수행
set_mode(AUTO)
print("auto start")
last_print = 0
end = time.time() + 300
while time.time() < end:
    msg = m.recv_match(
        type=["GLOBAL_POSITION_INT", "MISSION_ITEM_REACHED", "HEARTBEAT", "STATUSTEXT"],
        blocking=True, timeout=5,
    )
    if msg is None:
        continue
    kind = msg.get_type()
    if kind == "MISSION_ITEM_REACHED":
        print("REACHED waypoint", msg.seq)
    elif kind == "STATUSTEXT":
        print("[fc]", msg.text)
    elif kind == "HEARTBEAT":
        if not msg.base_mode & mav.MAV_MODE_FLAG_SAFETY_ARMED:
            print("landed and disarmed")
            break
    elif time.time() - last_print >= 2:
        last_print = time.time()
        y_m = (msg.lat / 1e7 - home_lat) * 111320
        x_m = (msg.lon / 1e7 - home_lon) * 111320 * math.cos(math.radians(home_lat))
        print(f"x={x_m:.1f} y={y_m:.1f} alt={msg.relative_alt / 1000:.1f}")
else:
    raise SystemExit("mission timeout")
