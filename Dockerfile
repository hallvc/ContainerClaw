FROM denoland/deno:2.1.4

WORKDIR /app

# Copy dependency manifest first for layer caching
COPY deno.json ./

# Copy source
COPY src/ src/

# Pre-cache dependencies
RUN deno cache src/main.ts

# Create data and workspace directories
RUN mkdir -p /data /workspace

EXPOSE 18790

CMD ["run", "--allow-all", "src/main.ts"]
