FROM python:3.12-slim
WORKDIR /app
COPY pyproject.toml ./
RUN pip install --no-cache-dir ".[compute]"
COPY pes_rs_pipeline ./pes_rs_pipeline
CMD ["python", "-m", "pes_rs_pipeline.runner"]
