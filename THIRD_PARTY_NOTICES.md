# 제3자 고지 (Third-Party Notices)

이 저장소의 코드·문서·그림(스크린샷 포함)은 **dae-won-kim**이 직접 만들었고 [MIT 라이선스](LICENSE)로 배포합니다.
아래 항목은 예외로, **각 저작권자의 소유이며 각자의 라이선스를 따릅니다.** 이 저장소의 MIT 라이선스는 아래 항목에 적용되지 않습니다.

## 1. 웹 앱이 실행 중에 불러오는 것 (저장소에 파일로 포함하지 않음)

| 이름 | 용도 | 저작권자 | 라이선스 | 불러오는 곳 |
|---|---|---|---|---|
| [supabase-js](https://github.com/supabase/supabase-js) 2.118.0 | DB·Auth API 클라이언트 | Supabase, Inc. | MIT | jsDelivr CDN (`web/js/main.js`, 버전 고정 + SRI) |
| [Gowun Batang](https://fonts.google.com/specimen/Gowun+Batang) | 본문 글꼴 | Yanghee Ryu | SIL Open Font License 1.1 | Google Fonts (`web/index.html`) |
| [Dancing Script](https://fonts.google.com/specimen/Dancing+Script) | 제목 장식 글꼴 | Impallari Type | SIL Open Font License 1.1 | Google Fonts (`web/index.html`) |

- 글꼴 파일은 Google Fonts에서 바로 받아 쓰고, 이 저장소에 넣거나 고쳐서 배포하지 않습니다.
- 샘플 사진의 그림 문자(⛄ 등)는 이미지 파일이 아니라 **보는 사람 기기의 이모지 글꼴**로 그립니다.
- 산타·사슴 캐릭터, 장식·선물 상자, 트리 무늬는 그림 파일 없이 캔버스 도형으로 직접 그렸습니다.
- `docs/images/`의 스크린샷과 데모 GIF에 보이는 이모지(장식 버튼 아이콘 등)는 촬영한 PC의 이모지 글꼴(Windows: Segoe UI Emoji, Microsoft Corporation)로 그려진 것으로,
  그 글리프 디자인은 해당 저작권자의 소유입니다. 데모 GIF 속 사진 그림(눈사람 · 선물 · 촛불)은 이모지 없이 캔버스 도형으로 직접 그렸습니다(`scripts/record-gif.cjs`).

## 2. 개발·테스트에만 쓰는 것 (웹 앱에 포함되지 않음)

| 이름 | 용도 | 저작권자 | 라이선스 |
|---|---|---|---|
| [Playwright](https://github.com/microsoft/playwright) (`@playwright/test` 1.64.1) | E2E 테스트 | Microsoft Corporation | Apache License 2.0 |
| [PostgreSQL](https://www.postgresql.org/) (`postgres:17.12` Docker 이미지) | DB 테스트 | The PostgreSQL Global Development Group | PostgreSQL License |
| [Pillow](https://github.com/python-pillow/Pillow) | README 데모 GIF 만들기 (`scripts/make-gif.py`, 저장소에 포함하지 않고 각자 설치) | Jeffrey A. Clark and contributors (원본 PIL: Secret Labs AB, Fredrik Lundh) | MIT-CMU License |

## 3. 외부 서비스
아래 서비스는 소프트웨어를 가져다 쓰는 것이 아니라 **API로 연결해 이용**합니다. 각 서비스의 이용약관을 따릅니다.
- **Supabase** — DB, 파일 저장소, 이메일 인증(복구 PIN 메일)
- **GitHub Pages / GitHub Actions** — 웹 호스팅, CI
- **Google Fonts** — 글꼴 제공
- **Resend** — 복구 메일 발송 (Supabase Auth의 Custom SMTP, 운영자 계정, 저장소에는 설정값 없음)
- **Cloudflare Registrar / DNS** — 도메인(`make-xmas-tree.com`) 등록 · DNS 관리

이 저장소는 위 서비스나 회사와 제휴·후원 관계가 없습니다.

## 4. 상표
Supabase, PostgreSQL, GitHub, Google, Resend, Cloudflare 등 이 문서에 나오는 이름은 각 소유자의 상표입니다.
이 이름들은 사용한 기술을 설명하는 데만 씁니다.
