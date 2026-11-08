// Field-check guidance drawn from IEC TS 62446-3:2017 (outdoor thermography of PV plants). Only items confirmed in the
// standard's public text carry a clause reference; the grading table (Table 4) was not available and is marked as such.
export const CONDITIONS = [['일사량', '일사계 또는 기준 셀, 교정 ±5%'], ['기온', '직사광·바람을 가린 온도계, 교정 ±2 K'], ['풍속', '보퍼트 등급 또는 풍속계'], ['운량', '사진으로 추정'], ['오염도', '사진으로 추정'], ['모듈·스트링 전류', 'DC 클램프 전류계, 교정 ±2%']];

export const PROCEDURE = [
  ['안전 확보', '현장 안전 규정에 따라 2인 이상으로 점검하고 설비·전기 구성 설명을 먼저 받습니다.', 'IEC TS 62446-3 §5.1'],
  ['측정 조건', '정상 운전, 열적 안정, 부분 음영 없는 상태에서 촬영합니다. 오염이 심하면 청소 후 안정되면 다시 촬영합니다.', 'IEC TS 62446-3 §5.1'],
  ['조건 기록', '4장의 측정 조건 항목을 기록합니다.', 'IEC TS 62446-3 §4.4 표 2'],
  ['온도 측정', '방사 열화상으로 이상 부위와 같은 스트링 정상 모듈의 온도를 함께 기록합니다.', 'IEC TS 62446-3 §4'],
  ['가시광 사진', '열화상 이상마다 같은 범위의 가시광 사진을 남깁니다.', 'IEC TS 62446-3 §4.3'],
  ['등급 판정', '이상 등급표와 국내 점검 지침의 온도차 기준으로 등급을 정합니다.', '확인 필요 · 표 4 원문, 국내 지침'],
  ['원인 확인·조치', '오염·음영, 셀 손상, 바이패스 다이오드, 정션박스·커넥터 순으로 원인을 좁히고 정비를 요청합니다.', '일반 점검 관행'],
  ['재점검', '정비한 구역은 선택 점검으로 다시 비행해 결과를 비교합니다.', 'SunPatch 운영']
];

export const FIELD_CHECKS = ['표면 오염·이물과 주변 음영 확인, 있으면 제거 후 재촬영', '방사 열화상으로 해당 부위와 정상 모듈 온도 기록', '가시광 사진으로 셀 균열·변색·유리 파손 확인', '정션박스·바이패스 다이오드 발열 확인'];

export function conditionsSection() {
  return `<h2>5. 점검 조건</h2><p>열화상 이상을 바르게 판단하려면 측정 당시 조건을 기록해야 합니다(IEC TS 62446-3 §4.4 표 2). 이번 점검은 시뮬레이터 비행이라 현장 값이 없습니다.</p>
    <div class="report-table"><table><thead><tr><th>항목</th><th>기록 장비</th><th>이번 점검</th></tr></thead><tbody>${CONDITIONS.map(([name, tool]) => `<tr><td>${name}</td><td>${tool}</td><td>미측정</td></tr>`).join('')}</tbody></table></div>`;
}

export function procedureSection() {
  return `<h2>6. 핫스팟 발생 시 점검 요령</h2><p>IEC TS 62446-3 공개 본문에서 확인한 항목과 일반 점검 관행입니다.</p>
    <div class="report-table"><table><thead><tr><th class="narrow">단계</th><th>내용</th><th>근거</th></tr></thead><tbody>${PROCEDURE.map(([name, text, source], i) => `<tr><td>${i + 1}. ${name}</td><td>${text}</td><td class="source">${source}</td></tr>`).join('')}</tbody></table></div>
    <p class="fine">정기 열화상 점검 권장 주기는 4년이며, 국내 전기설비 안전 규정이 정한 주기가 있으면 그에 따릅니다(IEC TS 62446-3 §5.1).</p>`;
}
