FROM ubuntu:latest
RUN apt update && apt install -y freeradius
COPY radius/ /etc/freeradius/
CMD ["freeradius", "-X"]
