# Stage 1: Build the TypeScript application
# Best practice: use Alpine for smaller image size, pin major version for stability
FROM node:22-alpine AS build

# Set the working directory inside the container
WORKDIR /app

# Copy package files first for better Docker layer caching
# Best practice: separate dependency install from source copy so npm install
# is only re-run when package.json or package-lock.json changes
COPY package.json package-lock.json ./

# Install all dependencies (including devDependencies for TypeScript compiler)
# Best practice: use npm ci for reproducible builds from lock file
RUN npm ci

# Copy the TypeScript source code
COPY tsconfig.json ./
COPY src ./src

# Compile TypeScript to JavaScript in dist/
RUN npm run build

# Stage 2: Production runtime image
# Best practice: multi-stage build keeps final image small by excluding
# build tools, devDependencies, and source files
#
# Use Debian slim (not Alpine) for the runtime stage because Alpine uses musl
# libc which does not support glibc NSS plugins. Debian's glibc is required
# for libnss-mdns, which enables .local mDNS resolution (e.g. diva.local)
# via the host's Avahi daemon socket mounted in docker-compose.yml.
FROM node:22-slim AS runtime

# Install libnss-mdns so the container can resolve .local mDNS hostnames
# via the host's running avahi-daemon (socket mounted at runtime).
RUN apt-get update && apt-get install -y --no-install-recommends libnss-mdns && \
    rm -rf /var/lib/apt/lists/* && \
    # Enable mdns4_minimal in NSS lookup order before falling back to DNS.
    # mdns4_minimal handles only .local names; [NOTFOUND=return] prevents
    # unnecessary DNS fallback when a .local name isn't found via mDNS.
    sed -i 's/^hosts:.*/hosts: files mdns4_minimal [NOTFOUND=return] dns mdns4/' /etc/nsswitch.conf

# Set the working directory
WORKDIR /app

# Copy package files for production dependency install
COPY package.json package-lock.json ./

# Install only production dependencies (no devDependencies)
# Best practice: --omit=dev excludes typescript, vitest, etc. from the image
RUN npm ci --omit=dev

# Copy compiled JavaScript from the build stage
# Only the dist/ folder is needed at runtime, not the TypeScript source
COPY --from=build /app/dist ./dist

# Run as non-root user for security
# Best practice: never run containers as root to limit blast radius
USER node

# Start the application
# Best practice: use CMD array form to avoid shell wrapper overhead
CMD ["node", "dist/index.js"]
