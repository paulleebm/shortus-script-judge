# 판정 서버(공개용). docker-compose.yml(Portainer 스택)로 띄우고, 공개 HTTPS 주소는 같은 스택의 Tailscale 컨테이너가 Funnel로 만든다(DECISIONS 22·23·24).
# 인증은 컨테이너 환경 변수 ANTHROPIC_API_KEY로 한다. 컨테이너에는 gcloud가 없어 WIF 토큰 명령을 쓸 수 없다(DECISIONS 15).
FROM node:22-slim

WORKDIR /app
COPY package.json package-lock.json ./
# 서버는 tsx로 TypeScript를 바로 돌리므로 개발 의존성까지 설치한다
RUN npm ci --ignore-scripts && npm cache clean --force
COPY tsconfig.json ./
COPY src ./src

RUN mkdir -p /app/runs && chown node:node /app/runs
USER node

ENV JUDGE_HOST=0.0.0.0 \
    JUDGE_PORT=8787
EXPOSE 8787

HEALTHCHECK --interval=60s --timeout=5s --retries=3 \
  CMD node -e "const id=(process.env.JUDGE_EXTENSION_IDS||'healthcheck').split(',')[0].trim();fetch('http://127.0.0.1:8787/health',{headers:{origin:'chrome-extension://'+id}}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node_modules/.bin/tsx", "src/server.ts"]
