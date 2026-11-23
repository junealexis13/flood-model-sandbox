FROM mambaorg/micromamba:1.5.10

USER root
WORKDIR /app

COPY flow_sim_backend/environment.yml /tmp/environment.yml
RUN micromamba install -y -n base -f /tmp/environment.yml \
    && micromamba clean --all --yes \
    && rm -f /tmp/environment.yml

ENV PATH="/opt/conda/bin:${PATH}" \
    FLOW_SIM_DATA_DIR=/app/flow_data \
    SAMPLE_DEM_DIR=/opt/sample-dem \
    PYTHONUNBUFFERED=1 \
    OMP_NUM_THREADS=1

COPY flow_sim_backend/app /app/app
COPY sample_rasters/ /opt/sample-dem/

RUN mkdir -p /app/flow_data

EXPOSE 8001
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]
