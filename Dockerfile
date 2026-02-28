FROM denoland/deno:2.6.9

# Install system dependencies for skills
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    nodejs \
    npm \
    pandoc \
    poppler-utils \
    && rm -rf /var/lib/apt/lists/*

# Install Python packages for skills
RUN pip3 install --break-system-packages --no-cache-dir \
    pypdf \
    pdfplumber \
    python-docx \
    openpyxl \
    pandas \
    reportlab \
    Pillow \
    scrapling

WORKDIR /app

# Copy dependency manifest first for layer caching
COPY deno.json ./

# Copy source (includes src/skills/)
COPY src/ src/

# Pre-cache dependencies
RUN deno cache src/main.ts

# Create data and workspace directories; copy defaults for seeding
RUN mkdir -p /data /workspace
COPY defaults/ /app/defaults/

EXPOSE 18790

CMD ["run", "--allow-all", "src/main.ts"]
