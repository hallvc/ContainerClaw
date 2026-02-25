FROM denoland/deno:2.6.9

WORKDIR /app

# Copy dependency manifest first for layer caching
COPY deno.json ./

# Copy source
COPY src/ src/

# Pre-cache dependencies
RUN deno cache src/main.ts

# Create data and workspace directories; copy defaults for seeding
RUN mkdir -p /data /workspace
COPY defaults/ /app/defaults/

EXPOSE 18790

CMD ["run", "--allow-all", "src/main.ts"]
