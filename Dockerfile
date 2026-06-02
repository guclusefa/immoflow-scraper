FROM mcr.microsoft.com/playwright:v1.44.0-jammy

# Prevent redundant browser downloads during npm install
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# Default command to execute when the container runs
CMD ["npm", "run", "scrape"]