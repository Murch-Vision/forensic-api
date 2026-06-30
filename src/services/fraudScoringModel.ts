/* -.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.
 * File Name   : fraudScoringModel.ts
 * Created at  : 2026-06-23
 * Updated at  : 2026-06-23
 * Author      : jeefo
 * Purpose     :
 * Description :
.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.*/

// Ported from Services/FraudScoringModel.cs — a logistic-regression fraud
// scorer. Untrained by default (matching the original: the rule engine is
// the authoritative path; the model is a "second opinion" hidden until an
// analyst trains it). Train() fits weights via gradient descent.

export interface TrainSummary {
  examples : number;
  features : number;
  auc      : number;
  epochs   : number;
}

export class FraudScoringModel {
  private weights: number[] = [];
  private bias = 0;
  private trained = false;

  get isTrained(): boolean {
    return this.trained;
  }

  get featureCount(): number {
    return this.weights.length;
  }

  predict(features: number[]): number {
    if (!this.trained || features.length !== this.weights.length) return NaN;
    let z = this.bias;
    for (let i = 0; i < features.length; i++) z += this.weights[i] * features[i];
    return 1 / (1 + Math.exp(-z));
  }

  train(
    examples: {features: number[]; label: boolean}[],
    epochs = 200,
    learningRate = 0.05
  ): TrainSummary {
    if (examples.length === 0) {
      throw new Error("Label set is empty.");
    }
    const n = examples[0].features.length;
    this.weights = new Array(n).fill(0);
    this.bias = 0;
    for (let e = 0; e < epochs; e++) {
      for (const ex of examples) {
        let z = this.bias;
        for (let i = 0; i < n; i++) z += this.weights[i] * ex.features[i];
        const p = 1 / (1 + Math.exp(-z));
        const err = p - (ex.label ? 1 : 0);
        for (let i = 0; i < n; i++) {
          this.weights[i] -= learningRate * err * ex.features[i];
        }
        this.bias -= learningRate * err;
      }
    }
    this.trained = true;
    return {examples: examples.length, features: n, auc: this.auc(examples), epochs};
  }

  private auc(examples: {features: number[]; label: boolean}[]): number {
    const scored = examples.map((ex) => ({p: this.predict(ex.features), y: ex.label}));
    const pos = scored.filter((s) => s.y);
    const neg = scored.filter((s) => !s.y);
    if (pos.length === 0 || neg.length === 0) return 0.5;
    let wins = 0;
    for (const a of pos) for (const b of neg) {
      if (a.p > b.p) wins += 1;
      else if (a.p === b.p) wins += 0.5;
    }
    return wins / (pos.length * neg.length);
  }
}
