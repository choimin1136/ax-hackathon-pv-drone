# 협업 규칙

이 저장소는 public입니다. 커밋 기록까지 공개되므로 **올리기 전에 항상 `git status`로 확인합니다.**

## 기본 원칙

- `main`에 직접 push하지 않습니다.
- 기능마다 브랜치를 만들고 Pull Request(PR)로 합칩니다.
- `main`은 항상 실행되는 상태로 유지하고, 배포는 `main`에서만 합니다.

## 브랜치 이름

`종류/작업-내용` 형식으로 씁니다.

| 종류 | 용도 | 예시 |
|---|---|---|
| `feat` | 기능 추가 | `feat/mission-map` |
| `fix` | 버그 수정 | `fix/upload-retry` |
| `docs` | 문서 | `docs/readme-demo-url` |
| `chore` | 설정, 환경 | `chore/add-env-example` |

## 작업 순서

### 1. 최신 `main`에서 브랜치 만들기

```bash
git switch main
git pull
git switch -c feat/작업-내용
```

### 2. 커밋하고 올리기

```bash
git status
git add <파일>
git commit -m "feat: 작업 내용"
git push -u origin feat/작업-내용
```

커밋 메시지는 `feat:`, `fix:`, `docs:`, `chore:`로 시작합니다.

### 3. PR 만들기

```bash
gh pr create --base main --fill
```

PR에는 무엇을 바꿨는지와 어떻게 확인했는지를 적습니다.

### 4. 리뷰하고 합치기

다른 팀원 1명이 확인한 뒤 squash merge합니다.

```bash
gh pr merge --squash --delete-branch
```

### 5. 내 환경 정리

```bash
git switch main
git pull
```

## main이 먼저 바뀌었을 때

```bash
git switch feat/작업-내용
git fetch origin
git merge origin/main
```

충돌이 나면 해당 파일을 수정한 뒤 다음을 실행합니다.

```bash
git add <수정한 파일>
git commit
git push
```

## 공용 서버 사용

- **개인 작업 폴더:** 같은 폴더에서 함께 작업하면 서로의 변경이 섞입니다. `/data/hackathon/<이름>/`에 각자 clone합니다.
- **배포 폴더:** `/data/hackathon/deploy/`는 배포 전용입니다. 여기서는 코드를 수정하지 않고 `main`만 pull합니다.
- **포트:** 개발 서버 포트가 겹치지 않도록 팀원별로 정합니다.

## 올리면 안 되는 것

- PEM 키, API Key, 비밀번호, `.env`
- 서빙 URL을 직접 적은 코드 (`.env`로 관리)
- AI Hub 데이터와 사진, 대용량 파일
- 사진 메타데이터의 기체 일련번호와 실제 좌표

키를 올렸다면 파일만 지워서는 안 됩니다. **커밋 기록에 남으므로 즉시 재발급하고 팀에 알립니다.**

## 마감 일정

| 시점 | 규칙 |
|---|---|
| 11/8 10:30 | 새 기능 merge 중단, 이후 버그 수정만 |
| 11/8 11:20 | 최종 배포와 공개 URL 확인 |
| 11/8 11:50 | 제출 마감 |

시간은 팀 상황에 맞게 조정할 수 있습니다.
