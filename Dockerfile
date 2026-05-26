ARG PLAYWRIGHT_VERSION=1.51.0

FROM mcr.microsoft.com/playwright/java:v${PLAYWRIGHT_VERSION}-noble AS backend-dev
WORKDIR /workspace

ENV TZ=Asia/Shanghai \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        fonts-noto-cjk \
        xauth \
        xvfb \
    && rm -rf /var/lib/apt/lists/*

EXPOSE 8888

FROM mcr.microsoft.com/playwright:v${PLAYWRIGHT_VERSION}-noble AS frontend-dev
WORKDIR /workspace/front

ENV TZ=Asia/Shanghai \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    NEXT_TELEMETRY_DISABLED=1 \
    CHOKIDAR_USEPOLLING=true \
    WATCHPACK_POLLING=true

RUN corepack enable && corepack prepare pnpm@10.20.0 --activate

EXPOSE 6866

FROM mcr.microsoft.com/playwright:v${PLAYWRIGHT_VERSION}-noble AS frontend-build
WORKDIR /workspace/front
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@10.20.0 --activate
COPY front/package.json front/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY front/ ./
RUN pnpm build && test -d out

FROM mcr.microsoft.com/openjdk/jdk:21-ubuntu AS backend-build
WORKDIR /workspace
COPY gradlew settings.gradle build.gradle.kts ./
COPY gradle ./gradle
RUN chmod +x ./gradlew
COPY src ./src
COPY --from=frontend-build /workspace/front/out ./src/main/resources/dist
RUN ./gradlew --no-daemon clean bootJar -x test

FROM mcr.microsoft.com/playwright/java:v${PLAYWRIGHT_VERSION}-noble AS runtime
WORKDIR /app

ENV TZ=Asia/Shanghai \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    JAVA_OPTS="-Dfile.encoding=UTF-8 -Dsun.stdout.encoding=UTF-8 -Dsun.stderr.encoding=UTF-8" \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        fonts-noto-cjk \
        xauth \
        xvfb \
    && rm -rf /var/lib/apt/lists/*

COPY --from=backend-build /workspace/build/libs/*.jar /app/app.jar
COPY --from=backend-build /workspace/src/main/resources/dist /app/src/main/resources/dist

RUN mkdir -p /app/db /app/data /app/output /app/logs /app/target/logs

EXPOSE 8888 6866 7866

CMD ["bash", "-lc", "exec xvfb-run -a -s '-screen 0 1920x1080x24' java ${JAVA_OPTS} -jar /app/app.jar"]
