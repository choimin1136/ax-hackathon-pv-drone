"""가상 발전소 셀 미션을 SITL로 비행하고 비행 기록(JSONL)을 남깁니다."""
import argparse
import json
import math
import time
from datetime import datetime
from pathlib import Path

from pymavlink import mavutil

mav = mavutil.mavlink

GUIDED, AUTO = 4, 3
ROWS = "ABCD"
COLS = 6
CELL_M = 20
ALT_M = 30
HOLD_S = 2
VEHICLE_ID = "sitl_01"
HOME_X_M = -30  # 이륙장은 발전소 격자 왼쪽 밖에 둡니다.
HOME_Y_M = 30


def plant_cells():
    """A-1~D-6을 지그재그 비행 순서로 반환합니다. 사진은 셀에 고정됩니다."""
    cells = []
    for r, row in enumerate(ROWS):
        cols = range(COLS) if r % 2 == 0 else reversed(range(COLS))
        for c in cols:
            cells.append({
                "cell_id": f"{row}-{c + 1}",
                "x_m": c * CELL_M,
                "y_m": r * CELL_M,
                "source_photo": f"photo_{len(cells) + 1:03d}.jpg",
            })
    return cells


def select_cells(names):
    cells = plant_cells()
    if not names:
        return cells
    wanted = set(names.split(","))
    unknown = wanted - {c["cell_id"] for c in cells}
    if unknown:
        raise SystemExit(f"unknown cells: {sorted(unknown)}")
    return [c for c in cells if c["cell_id"] in wanted]


class Drone:
    TYPES = ["GLOBAL_POSITION_INT", "ATTITUDE", "SYS_STATUS", "HEARTBEAT", "COMMAND_ACK", "MISSION_ITEM_REACHED", "STATUSTEXT"]

    def __init__(self, url, mission_id):
        self.mission_id = mission_id
        self.log = None
        self.home = None
        self.pos = None
        self.battery = None
        self.attitude = {}
        self.t0 = None
        self.last_write = 0
        self.m = mavutil.mavlink_connection(url)
        self.m.wait_heartbeat()
        self.ts, self.tc = self.m.target_system, 1
        self.m.mav.request_data_stream_send(self.ts, self.tc, mav.MAV_DATA_STREAM_ALL, 4, 1)

    def write(self, kind, **data):
        line = {"type": kind, "mission_id": self.mission_id, "t": round(time.monotonic() - self.t0, 1), **data}
        self.log.write(json.dumps(line, ensure_ascii=False) + "\n")
        self.log.flush()

    def event(self, text):
        print(text)
        self.write("log", source="mission", text=text)

    def read(self, timeout=1):
        msg = self.m.recv_match(type=self.TYPES, blocking=True, timeout=timeout)
        if msg is None:
            return None
        kind = msg.get_type()
        if kind == "STATUSTEXT":
            print("[fc]", msg.text)
            if self.t0 is not None:
                self.write("log", source="fc", text=msg.text)
        elif kind == "ATTITUDE":
            self.attitude = {"roll": round(math.degrees(msg.roll), 1), "pitch": round(math.degrees(msg.pitch), 1)}
        elif kind == "SYS_STATUS" and msg.battery_remaining >= 0:
            self.battery = msg.battery_remaining
        elif kind == "GLOBAL_POSITION_INT" and msg.lat != 0:
            if self.home is None:
                self.home = (msg.lat / 1e7, msg.lon / 1e7)
            # 실제 좌표는 기록하지 않고 발전소 상대 좌표만 남깁니다.
            self.pos = {
                "x_m": round(HOME_X_M + (msg.lon / 1e7 - self.home[1]) * 111320 * math.cos(math.radians(self.home[0])), 1),
                "y_m": round(HOME_Y_M + (msg.lat / 1e7 - self.home[0]) * 111320, 1),
                "rel_alt_m": round(msg.relative_alt / 1000, 1),
            }
            if self.t0 is not None and time.monotonic() - self.last_write >= 0.5:
                self.last_write = time.monotonic()
                self.write("position", position=self.pos, heading=msg.hdg / 100, battery=self.battery, **self.attitude)
        return msg

    def wait_home(self):
        end = time.monotonic() + 120
        while self.home is None:
            if time.monotonic() > end:
                raise SystemExit("gps timeout")
            self.read()
        print("home ready")

    def command(self, cmd, *params):
        params = list(params) + [0] * (7 - len(params))
        self.m.mav.command_long_send(self.ts, self.tc, cmd, 0, *params)
        end = time.monotonic() + 3
        while time.monotonic() < end:
            msg = self.read()
            if msg is not None and msg.get_type() == "COMMAND_ACK" and msg.command == cmd:
                return msg.result == mav.MAV_RESULT_ACCEPTED
        return False

    def set_mode(self, mode):
        for _ in range(10):
            self.m.mav.set_mode_send(self.ts, mav.MAV_MODE_FLAG_CUSTOM_MODE_ENABLED, mode)
            end = time.monotonic() + 2
            while time.monotonic() < end:
                msg = self.read()
                if msg is not None and msg.get_type() == "HEARTBEAT" and msg.custom_mode == mode:
                    return
        raise SystemExit(f"mode {mode} failed")

    def upload(self, cells):
        lat0, lon0 = self.home
        rel = mav.MAV_FRAME_GLOBAL_RELATIVE_ALT_INT
        items = [(mav.MAV_FRAME_GLOBAL_INT, mav.MAV_CMD_NAV_WAYPOINT, 0, lat0, lon0, 0)]
        for c in cells:
            lat = lat0 + (c["y_m"] - HOME_Y_M) / 111320
            lon = lon0 + (c["x_m"] - HOME_X_M) / (111320 * math.cos(math.radians(lat0)))
            items.append((rel, mav.MAV_CMD_NAV_WAYPOINT, HOLD_S, lat, lon, ALT_M))
        items.append((rel, mav.MAV_CMD_NAV_RETURN_TO_LAUNCH, 0, 0, 0, 0))

        self.m.mav.mission_count_send(self.ts, self.tc, len(items))
        while True:
            msg = self.m.recv_match(type=["MISSION_REQUEST_INT", "MISSION_REQUEST", "MISSION_ACK"], blocking=True, timeout=5)
            if msg is None:
                raise SystemExit("mission upload timeout")
            if msg.get_type() == "MISSION_ACK":
                if msg.type != mav.MAV_MISSION_ACCEPTED:
                    raise SystemExit(f"mission rejected: {msg.type}")
                break
            frame, cmd, hold, lat, lon, alt = items[msg.seq]
            self.m.mav.mission_item_int_send(
                self.ts, self.tc, msg.seq, frame, cmd, 0, 1,
                hold, 0, 0, 0, int(lat * 1e7), int(lon * 1e7), alt,
            )
        print("mission uploaded", len(cells), "cells")

    def arm(self):
        end = time.monotonic() + 90
        while not self.command(mav.MAV_CMD_COMPONENT_ARM_DISARM, 1):
            if time.monotonic() > end:
                raise SystemExit("arm failed")
            time.sleep(2)
        print("armed")

    def takeoff(self):
        if not self.command(mav.MAV_CMD_NAV_TAKEOFF, 0, 0, 0, 0, 0, 0, ALT_M):
            raise SystemExit("takeoff rejected")
        end = time.monotonic() + 60
        while self.pos is None or self.pos["rel_alt_m"] < ALT_M * 0.95:
            if time.monotonic() > end:
                raise SystemExit("takeoff timeout")
            self.read()
        self.event("이륙 완료")

    def fly(self, cells):
        frames = 0
        end = time.monotonic() + 900
        while time.monotonic() < end:
            msg = self.read()
            if msg is None:
                continue
            kind = msg.get_type()
            if kind == "MISSION_ITEM_REACHED" and 1 <= msg.seq <= len(cells):
                cell = cells[msg.seq - 1]
                frames += 1
                self.write(
                    "frame", vehicle_id=VEHICLE_ID, cell_id=cell["cell_id"], waypoint=msg.seq,
                    source_photo=cell["source_photo"], position=self.pos, battery=self.battery,
                    captured_at=datetime.now().isoformat(timespec="seconds"),
                )
                print(f"[frame] {frames}/{len(cells)} {cell['cell_id']} {self.pos}")
            elif kind == "HEARTBEAT" and not msg.base_mode & mav.MAV_MODE_FLAG_SAFETY_ARMED:
                return frames
        raise SystemExit("mission timeout")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--mission-id", default="mission_01")
    parser.add_argument("--cells", help="재점검할 셀 (예: C-4,C-5). 생략하면 전체")
    parser.add_argument("--connect", default="tcp:127.0.0.1:5760")
    parser.add_argument("--out-dir", default="drone/sample_flight")
    args = parser.parse_args()

    cells = select_cells(args.cells)
    out = Path(args.out_dir) / f"{args.mission_id}.jsonl"
    out.parent.mkdir(parents=True, exist_ok=True)

    # 연결에 실패해도 기존 기록이 지워지지 않도록 연결 후에 파일을 엽니다.
    drone = Drone(args.connect, args.mission_id)
    drone.wait_home()
    drone.upload(cells)
    drone.set_mode(GUIDED)
    drone.arm()
    with out.open("w", encoding="utf-8") as log:
        drone.log = log
        drone.t0 = time.monotonic()
        drone.write("mission_start", cells=[c["cell_id"] for c in cells])
        drone.event(f"미션 업로드와 시동 완료 ({len(cells)}개 셀)")
        drone.takeoff()
        drone.set_mode(AUTO)
        drone.event("AUTO 모드로 미션 수행 시작")
        frames = drone.fly(cells)
        drone.write("mission_end", frames=frames, planned=len(cells))
    print(f"landed: {frames}/{len(cells)} frames -> {out}")
    if frames != len(cells):
        raise SystemExit("some frames are missing")


if __name__ == "__main__":
    main()
