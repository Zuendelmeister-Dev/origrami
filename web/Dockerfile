FROM node:22-alpine AS dependencies
WORKDIR /app
COPY package*.json ./
RUN npm ci --no-audit --no-fund

FROM dependencies AS tooling
COPY . .
CMD ["npm", "test"]

FROM tooling AS build
ARG VITE_MATRIX_URL=http://localhost:8008
ENV VITE_MATRIX_URL=$VITE_MATRIX_URL
RUN npm run build

FROM nginx:1.30.6-alpine AS runtime
COPY nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
