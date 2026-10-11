# syntax=docker/dockerfile:1

# ---- Build stage: compile and package the Spring Boot jar ----
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /build

# Resolve dependencies in their own layer so a source-only change does not download them again.
COPY pom.xml .
RUN mvn -q -B dependency:go-offline

COPY src ./src
RUN mvn -q -B -DskipTests package

# ---- Runtime stage ----
FROM eclipse-temurin:21-jre
WORKDIR /app

# The JVM does not need root. curl is already part of this image and serves the health check below.
RUN groupadd --system app \
    && useradd --system --gid app --no-create-home --shell /usr/sbin/nologin app

# The glob skips the *.jar.original that the repackage step leaves next to the executable jar.
COPY --from=build --chown=app:app /build/target/backend-*.jar /app/app.jar

USER app
EXPOSE 8080

HEALTHCHECK --interval=10s --timeout=3s --start-period=40s --retries=5 \
    CMD curl --fail --silent --show-error http://localhost:8080/actuator/health || exit 1

ENTRYPOINT ["java", "-jar", "/app/app.jar"]
