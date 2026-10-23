# 인디·서브컬처 게임 행사 트래커

한국·일본·중국과 온라인 행사의 일정, 모집 정보와 Steam 인디 게임을 보여주는 정적 대시보드입니다.

[대시보드 열기](https://junshelp.github.io/indie-game-tracker-dashboard/)

## 로컬 실행

```sh
python3 -m http.server 8765 --bind 127.0.0.1
```

브라우저에서 http://127.0.0.1:8765 를 엽니다. HTML/CSS/JavaScript와 JSON만 사용하며 별도 빌드는 없습니다.

## 검증

```sh
python3 -m unittest discover -s tests -v
node tests/frontend.cjs
python3 scripts/validate_dashboard.py data
```

PR과 main 업데이트에도 같은 검증이 실행됩니다. 배포 스크립트는 검증에 실패하면 git 변경 전에 중단합니다.

## 데이터 갱신

수집·확정한 캘린더를 행사 JSON으로 변환하고 Steam 수집을 마친 뒤 한 번 배포합니다. 수집은 기존 Hermes cron에서 실행합니다. 이 저장소에 별도 수집 스케줄을 추가하지 않습니다.

```sh
python3 scripts/build_dashboard_data.py --no-drive --calendar-file /path/to/calendar.md --output /path/to/run/data --baseline-dir data
python3 scripts/steam_indie_watch.py --output /path/to/run/data/steam --baseline-dir data/steam --max-details 20
python3 scripts/validate_dashboard.py /path/to/run/data
python3 scripts/push_dashboard.py --data-dir /path/to/run/data --dry-run
python3 scripts/push_dashboard.py --data-dir /path/to/run/data
```

원격 수집에만 Python `requests`가 필요합니다. Google Drive 연결에는 로컬 Hermes 인증과 명시적 `--calendar-id` 또는 `INDIE_TRACKER_CALENDAR_ID`가 필요합니다. 인증 정보와 개인 문서 ID는 저장소에 보관하지 않습니다.

[데이터 기준](docs/data-model.md) · [운영·복구](docs/operations.md)
