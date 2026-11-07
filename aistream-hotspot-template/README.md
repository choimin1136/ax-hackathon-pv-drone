# AIStream Solar Hotspot 서빙 연결본

원본 Downloads 폴더는 수정하지 않았습니다. 제출 모델 코드와 hotspot.pt를 복사하고 HTTP 어댑터를 추가한 별도 결과물입니다.

## 플랫폼에서 사용할 순서

입출력 선언은 반드시 `main.py`와 같은 최상위의 **template-inout.yaml**에 적용합니다. `templete_inout`처럼 철자나 구분자가 다른 파일명을 새로 만들지 않습니다. 플랫폼이 기존 빈 설정을 보여 주면 템플릿 편집 화면의 해당 파일을 이 결과물의 설정으로 교체한 뒤 새 버전을 빌드합니다. 기존 빌드의 UI가 자동 갱신된다고 가정하지 않습니다.

| 방향 | 이름 | 종류 | 경로/형식 |
| --- | --- | --- | --- |
| INPUT | model | MLFLOW_MODEL | /app/volume/models/model, mlflow |
| OUTPUT | serving | SERVING | http, path 없음 |

`checkpoint=hotspot.pt` 파라미터는 연결된 model 입력 안에서 읽을 상대 파일명입니다. 모델 파일 연결 자체는 model 입력 포트에서 합니다. 이미지 요청과 추론 JSON/마스크 응답은 실행 후 HTTP API로 전달되며 DATASET 입출력 포트가 아닙니다.

1. `aistream-hotspot-template.zip` 내부 파일을 템플릿 소스로 적용합니다. 압축 내부 최상위는 main.py, pyproject.toml, template-inout.yaml, src/, solar_hotspot/입니다.
2. 플랫폼의 빌드 화면에서 Dockerfile을 사용합니다. Dockerfile.txt도 같은 내용으로 포함했으므로 플랫폼에서 요구하는 파일명에 맞춥니다. deployment.yaml은 받은 원본 그대로입니다.
3. `hotspot-model-files.zip`에는 최상위 hotspot.pt 하나가 들어 있습니다. 플랫폼의 모델 등록/파일 업로드 절차로 이 파일을 등록하고 Serving의 `model` 입력 포트에 연결합니다. **이 zip 자체가 MLflow 표준 모델 패키지는 아닙니다.** 플랫폼이 MLmodel 등 MLflow 패키징을 요구하면 그 절차로 등록해야 합니다. 임의의 MLflow flavor를 가장하지 않았습니다.
4. 선택한 등록 모델의 파일이 mountPath/hotspot.pt에 놓이면 기본 옵션 그대로 실행합니다.
5. 기존 모델 패키지 전체를 등록해 mountPath/models/hotspot.pt가 된다면 `checkpoint` 옵션을 `models/hotspot.pt`로 지정합니다. 명령줄에서는 `--checkpoint models/hotspot.pt`입니다. 플랫폼이 추가 하위 디렉터리에 보관하면 그 실제 상대 경로를 지정해야 합니다.
6. 기존 Serving을 재사용할 경우 새 템플릿 버전과 올바른 모델 버전이 선택됐는지 확인한 뒤 새 버전으로 배포합니다.

`MODEL_INPUTS_JSON`은 플랫폼이 주입합니다. deployment.yaml에 직접 넣지 않습니다. 입력 포트명은 반드시 model입니다. 새로 제공된 model_inputs.py의 검증 함수를 그대로 사용합니다. 형식은 schemaVersion: 1, inputs.model.mode: FROM_VERSION이며 inputs.model 아래 registeredModelId, registeredModelVersionId, mlflowRegisteredModelName, mlflowModelVersion, mountPath 문자열이 필요합니다. 파일이 없거나 환경변수 형식이 다르면 명확한 오류로 시작을 중단합니다. 초기 연결본에서 사용한 최상위 model.mountPath 가정은 v0.1.2에서 수정했습니다.

이 템플릿은 모델 파일을 직접 로딩하므로 mlflow Python 패키지가 필요하지 않습니다. 입력 포트의 MLFLOW_MODEL 종류와 format: mlflow는 가져온 플랫폼 명세의 연결 계약을 따른 것입니다.

## 실행과 요청

원본 전체 결과물 폴더에는 로컬 검증용 models/hotspot.pt가 있습니다.

이 프로젝트는 패키지 설치가 아닌 uv 실행을 사용합니다. 플랫폼 Dockerfile과 동일하게 Python 3.11 환경에서 다음을 사용하세요.

```bash
uv sync --no-dev --no-install-project
uv run --no-sync python main.py
```

서빙 진입점은 CUDA로 고정되어 있으며 CPU/CUDA 선택 옵션은 없습니다. GPU가 컨테이너에 할당되고 CUDA 지원 PyTorch가 설치되어 있어야 합니다. GPU가 없으면 시작에 실패하며 CPU로 자동 전환하지 않습니다. CLI의 image-threshold, seg-threshold는 기본 0.5입니다. 고해상도 실이미지의 메모리와 실행시간은 별도 확인해야 합니다.

플랫폼 GPU 프로필은 코드의 device 설정과 별개인 배포 자원 선택입니다. 전달받은 원본 deployment.yaml에는 GPU resource/profile 선언이 없고 결과물에도 동일하게 유지했습니다. 프로필 UI를 활성화하는 플랫폼 필드는 자료에 없으므로 임의로 추가하지 않았습니다. 이미지 빌드 결과의 PyTorch CUDA 지원 및 실제 GPU 할당은 플랫폼에서 검증해야 합니다.

```bash
curl http://localhost:8000/health
curl -X POST http://localhost:8000/infer -F "file=@INPUT.jpg"
```

원본 API와 호환되도록 /infer에 bboxes와 output(data:image/jpeg;charset=utf-8;base64,... 오버레이)을 반환합니다. bboxes는 분할 영역의 외접 사각형이며 픽셀 단위 cx/cy/w/h, label=1(hotspot)입니다. 검출기 점수나 개별 영역의 결함 확률을 의미하지 않습니다. 추가 응답의 result는 기존 build_results JSON이며, mask_png_base64는 원본 해상도의 0/255 PNG 마스크입니다. /predict 및 /는 같은 API의 별칭입니다. SERVING_ROOT_PATH 환경변수도 반영합니다. 지리 좌표나 온도 측정값은 제공하지 않습니다. 이 배포는 메타데이터를 받지 않는 영상 전용 추론입니다.

원본 CLI의 RGB 변환, 0~1 스케일, 모델 내부 정규화/멀티뷰, scaler, calibration, 결과 생성 함수를 재사용합니다. 이미지 크기를 임의로 축소하지 않습니다. 최대 20 MiB/4백만 pixels 제한은 API 자원 보호용이며 해당 크기의 처리 성능을 보장하지 않습니다.

## 검증 범위

### 판단 확률 응답

응답 최상위에 probability(0~1), is_hotspot(boolean), decision_threshold(기본 0.5), calibrated(boolean)를 제공합니다. probability는 이미지 전체에 핫스팟이 하나 이상 있을 모델 점수로 result.prediction.final_probability와 같습니다. 영역별 확률이나 예측 정답률을 의미하지 않습니다. 현재 체크포인트는 calibrated=false이며 보정된 실제 발생 빈도로 해석하지 않습니다. 기존 bboxes/output/result/mask_png_base64도 유지합니다. 플랫폼 UI가 추가 필드를 표시하는지는 별도 확인이 필요합니다.

verify_local.py는 httpx를 추가 설치한 검증 환경에서 실행합니다. 실제 체크포인트 로딩, 합성 이미지 추론, 마스크 해상도, health, 잘못된 업로드 응답, 잘못된 모델 경로의 시작 실패를 확인합니다. 정확도 평가는 아닙니다.

플랫폼 이미지 빌드, Linux Python 3.11, GPU, 실제 모델 마운트, 플랫폼 외부 라우팅은 이 PC에서 검증하지 않았습니다.

원본 템플릿 AGENTS.md/README.md가 참조하는 .agents/skills 및 참조 문서는 제공 폴더에 없습니다. 해당 스킬을 실행하거나 그 계약 준수를 검증했다고 주장하지 않습니다. 이 README는 실제 구현과 확인된 입출력 문서를 기준으로 작성했습니다.
