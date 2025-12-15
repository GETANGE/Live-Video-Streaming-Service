/*
  Warnings:

  - You are about to drop the column `phoneNUmber` on the `User` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "User" DROP COLUMN "phoneNUmber",
ADD COLUMN     "phoneNumber" TEXT;
