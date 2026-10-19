FROM python:3.13-alpine AS test
WORKDIR /app
COPY server.py test_server.py ./
CMD ["python", "-B", "-m", "unittest", "discover", "-s", ".", "-p", "test_server.py", "-v"]

FROM matrixdotorg/synapse:v1.163.0 AS runtime
COPY server.py /opt/origrami/server.py
ENTRYPOINT ["python", "-B", "/opt/origrami/server.py"]
