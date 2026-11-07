# 구현 전 요구사항

- AIStream 템플릿의 main.py Click 진입점과 HTTP 8000 포트를 유지한다.
- 모델 입력 포트 model, SERVING 출력 포트를 선언한다.
- MODEL_INPUTS_JSON의 schemaVersion=1 및 inputs.model(FROM_VERSION)을 원본 model_inputs.py로 검증하고 mountPath를 사용한다.
- 제출된 solar_hotspot 코드와 hotspot.pt를 재사용하며 학습은 하지 않는다.
- CUDA 고정(사용자 후속 요청), 영상 전용 추론, 판정/분할 임계값 0.5를 사용한다.
- 이미지 multipart 업로드에 JSON 결과와 base64 PNG 마스크를 반환한다.
- 모델 로딩 실패 시 서버 시작을 중단한다. health는 로딩 완료 후 성공한다.

# 최종 구현 명세

- FastAPI + Uvicorn 단일 프로세스. Ray는 이 어댑터에 필요하지 않다.
- GET /health, GET /healthz; POST /infer, POST /predict 및 POST / (동일 API). SERVING_ROOT_PATH 반영.
- 필수 multipart file: 이미지. 메타데이터는 이번 영상 전용 배포에서 받지 않는다.
- 응답: 원본 DTO의 bboxes, output(JPEG data URI) 및 result(기존 build_results 출력), mask_png_base64(0/255 PNG).
- 최상위 probability는 이미지 전체에 핫스팟이 하나 이상 있을 모델 확률 점수(0~1)이며 result.prediction.final_probability와 같다. is_hotspot은 해당 점수가 decision_threshold 이상인지 나타낸다. calibrated는 확률 보정 적용 여부다. 영역별 확률을 의미하지 않는다.
- 파일 최대 20 MiB, 해상도 최대 4,000,000 pixels; 초과 요청은 413.
- 동시 모델 실행은 Lock으로 직렬화한다. 고해상도 GPU/CPU 메모리 적정치는 실환경 검증이 필요하다.
- 플랫폼 모델 입력 환경변수가 있으면 잘못된 설정/경로를 로컬 파일로 대체하지 않는다.
- 상대 checkpoint는 mountPath 아래로 제한한다. 중첩 폴더는 --checkpoint로 명시한다.
- 서빙 main.py의 device 선택 옵션을 제거하고 CUDA로 고정한다. CUDA 미지원 시 시작에 실패한다. CPU 검증은 내부 함수 인자를 명시하는 테스트에서만 수행한다.
- 실제 플랫폼 모델 등록 형식과 API 외부 라우팅은 미검증이다.
