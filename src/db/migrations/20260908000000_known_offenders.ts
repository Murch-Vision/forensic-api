/* -.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.
 * File Name   : 20260908000000_known_offenders.ts
 * Created at  : 2026-09-08
 * Author      : jeefo
 * Purpose     : Хэрэгтний бүртгэл — урьдчилан мэдэгдэж буй хүмүүсийн регистр.
 * Description : Гаднаас (Excel) ирдэг ЖАГСААЛТ. Хэргийн өгөгдөл БИШ тул
 *               хэрэг устгахад хамт устахгүй: бүх хэрэгт нэг адил үйлчилнэ.
 *
 *               nationalId нь цорын ганц түлхүүр — нэр байдаггүй, зөвхөн
 *               регистр ирдэг. labels нь тухайн хүн ямар жагсаалтад
 *               (Яллагдагч2019, ШШГЕГЯЛ2020, Зөрчил2021 …) байсныг хадгална:
 *               эх файлын БАГАНА БҮР нэг жагсаалт бөгөөд нэг хүн олонд
 *               давхар орж болно.
.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.-.*/
import type {Knex} from "knex";

export async function up(knex: Knex): Promise<void> {
  const exists = await knex.schema.hasTable("known_offenders");
  if (exists) return;
  await knex.schema.createTable("known_offenders", (t) => {
    t.increments("id").primary();
    // ЗААВАЛ томоор, зайгүй. Тулгалт үүн дээр л явна.
    t.string("nationalId").notNullable().unique();
    // JSON массив: ["Яллагдагч2019", "ШШГЕГЯЛ2020"].
    t.text("labels").notNullable().defaultTo("[]");
    t.string("sourceFile");
    t.datetime("createdAt").notNullable();
    t.datetime("updatedAt").notNullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("known_offenders");
}
