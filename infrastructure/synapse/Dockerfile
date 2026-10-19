FROM matrixdotorg/synapse:v1.163.0 AS tooling
WORKDIR /opt/origrami
COPY bootstrap.py test_bootstrap.py ./
ENTRYPOINT ["python", "-B"]
CMD ["-m", "unittest", "discover", "-s", ".", "-p", "test_bootstrap.py", "-v"]

FROM matrixdotorg/synapse:v1.163.0 AS runtime
COPY bootstrap.py /opt/origrami/bootstrap.py
ENTRYPOINT ["python", "-B", "/opt/origrami/bootstrap.py"]
