# KoEn-E5-Tiny (질의 임베딩용)

- 출처: https://huggingface.co/exp-models/dragonkue-KoEn-E5-Tiny-ONNX (`onnx/model_qint8_arm64.onnx` → `model_qint8.onnx`)
- 기반: intfloat/multilingual-e5-small (MIT) → dragonkue/multilingual-e5-small-ko (Apache-2.0) → 한국어·영어 어휘만 남긴 경량판
- 라이선스: Apache-2.0
- 384차원, 평균 풀링, e5 규칙(질의 `query: `, 문서 `passage: `)
- 문서 벡터(`data/index/embeddings-national.*`, `data/index/ord-emb/*`)는 같은 모델의 fp32 버전으로
  `scripts/embed_local.py`가 만든다. 질의는 서버에서 이 int8 모델로 임베딩한다(`lib/local-embed.ts`).
