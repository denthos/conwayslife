FROM alpine:latest

MAINTAINER Edward Muller <edward@heroku.com>

WORKDIR "/opt"

ADD .docker_build/conwayslife /opt/bin/conwayslife
ADD ./templates /opt/templates
ADD ./static /opt/static

CMD ["/opt/bin/conwayslife"]
