FROM nginx:1.27-alpine
COPY apps/frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY apps/frontend/public/ /usr/share/nginx/html/
EXPOSE 80
